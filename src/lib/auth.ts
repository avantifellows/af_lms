import { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import { getSchoolByPasscode } from "./permissions";

export const authOptions: NextAuthOptions = {
  secret: process.env.NEXTAUTH_SECRET,
  providers: [
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
  ],
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
  },
  session: {
    strategy: "jwt",
  },
};
