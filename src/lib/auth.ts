import type { NextAuthOptions } from "next-auth";
import type { Provider } from "next-auth/providers/index";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import { getSchoolByPasscode } from "./permissions";

// Dev login personas — each maps to a local fixture email in user_permission.
// Only used when NODE_ENV !== "production".
export const DEV_LOGIN_PERSONAS = {
  admin: { email: "e2e-holistic-global-admin@test.local", name: "Dev Admin" },
  program_manager: { email: "e2e-holistic-pm@test.local", name: "Dev PM" },
  program_admin: { email: "e2e-holistic-program-admin@test.local", name: "Dev Program Admin" },
  teacher: { email: "e2e-holistic-teacher@test.local", name: "Dev Teacher" },
  former_mentor: { email: "e2e-former-holistic-mentor@test.local", name: "Dev Former Mentor" },
  holistic_admin: { email: "e2e-holistic-admin@test.local", name: "Dev Holistic Admin" },
  read_only: { email: "e2e-holistic-read-only@test.local", name: "Dev Read-Only" },
} as const;

type DevPersonaKey = keyof typeof DEV_LOGIN_PERSONAS;

const providers: Provider[] = [
  GoogleProvider({
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  }),
  CredentialsProvider({
    id: "passcode",
    name: "School Passcode",
    credentials: {
      passcode: { label: "School Passcode", type: "text" },
    },
    async authorize(credentials) {
      if (!credentials?.passcode) return null;

      const schoolCode = getSchoolByPasscode(credentials.passcode);
      if (!schoolCode) return null;

      // Return a pseudo-user for passcode auth
      return {
        id: `passcode-${schoolCode}`,
        email: `passcode-${schoolCode}@school.local`,
        name: `School ${schoolCode}`,
        schoolCode,
      };
    },
  }),
];

if (process.env.NODE_ENV !== "production") {
  providers.push(
    CredentialsProvider({
      id: "dev-login",
      name: "Dev Login",
      credentials: {
        persona: { label: "Persona", type: "text" },
      },
      async authorize(credentials) {
        const key = credentials?.persona as DevPersonaKey | undefined;
        if (!key || !(key in DEV_LOGIN_PERSONAS)) return null;
        const persona = DEV_LOGIN_PERSONAS[key];
        return { id: `dev-${key}`, email: persona.email, name: persona.name };
      },
    })
  );
}

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  providers,
  callbacks: {
    async jwt({ token, user }) {
      // Add school code to token for passcode users
      if (user && "schoolCode" in user) {
        token.schoolCode = user.schoolCode;
        token.isPasscodeUser = true;
      }
      return token;
    },
    async session({ session, token }) {
      // Add school code to session for passcode users
      if (token.schoolCode) {
        session.schoolCode = token.schoolCode as string;
        session.isPasscodeUser = true;
      }
      return session;
    },
  },
  pages: {
    signIn: "/",
    signOut: "/signout",
  },
  session: {
    strategy: "jwt",
  },
};
