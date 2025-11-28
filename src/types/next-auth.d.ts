import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    schoolCode?: string;
    isPasscodeUser?: boolean;
  }

  interface User {
    schoolCode?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    schoolCode?: string;
    isPasscodeUser?: boolean;
  }
}
