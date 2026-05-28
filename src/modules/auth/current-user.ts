import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

export async function requireCurrentUser() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    throw new Error("Unauthorized");
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      tenantId: true,
      role: true,
      patientProfileId: true
    }
  });

  if (!user) {
    throw new Error("Unauthorized");
  }

  return user;
}
