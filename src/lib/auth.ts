import type { NextAuthOptions } from "next-auth";
import type { Provider } from "next-auth/providers/index";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import { isRetiredToken } from "./retired-session";

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
  pmu_manager: { email: "e2e-pmu-manager@test.local", name: "Dev PMU Manager" },
  pmu_govt_school_user: {
    email: "e2e-pmu-govt-school-user@test.local",
    name: "Dev PMU Govt School User",
  },
} as const;

type DevPersonaKey = keyof typeof DEV_LOGIN_PERSONAS;

const providers: Provider[] = [
  GoogleProvider({
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
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
    async jwt({ token }) {
      // Throwing makes NextAuth return an empty session, signing the client out.
      if (isRetiredToken(token)) {
        throw new Error("Retired passcode session");
      }
      return token;
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
