import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { type NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { bootstrapUserFromGoogleProfile } from "@/modules/auth/bootstrap-user";

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(db),
  session: { strategy: "database" },
  secret: env.nextAuthSecret,
  providers: [
    GoogleProvider({
      clientId: env.googleClientId,
      clientSecret: env.googleClientSecret,
      allowDangerousEmailAccountLinking: true
    })
  ],
  callbacks: {
    async signIn({ profile }) {
      if (!profile) return false;
      await bootstrapUserFromGoogleProfile({
        email: profile.email,
        name: profile.name,
        image: profile.image,
        sub: (profile as { sub?: string }).sub
      });
      return true;
    },
    async session({ session, user }) {
      const fullUser = await db.user.findUnique({
        where: { id: user.id },
        select: {
          id: true,
          tenantId: true,
          role: true
        }
      });

      if (session.user && fullUser) {
        session.user.id = fullUser.id;
        session.user.tenantId = fullUser.tenantId;
        session.user.role = fullUser.role;
      }

      return session;
    }
  }
};
