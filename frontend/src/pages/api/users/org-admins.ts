import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import fastApiClient from "../../../lib/fastapi";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ message: "Method Not Allowed" });
  }

  try {
    // Check authentication
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // Check if user is super admin
    const userRole = (session.user as any)?.role;
    if (userRole !== "super_admin") {
      return res.status(403).json({ message: "Forbidden: Super admin access required" });
    }

    // Get backend token from session
    const backendToken = (session as any).backendToken;
    if (!backendToken) {
      return res.status(401).json({ message: "Backend token not found" });
    }

    // Call backend API
    const response = await fastApiClient.get("/api/users/org-admins", {
      headers: {
        Authorization: `Bearer ${backendToken}`,
      },
    });

    return res.status(response.status).json(response.data);
  } catch (error: any) {
    console.error("Error fetching org admins:", error);
    return res.status(500).json({
      message: error?.response?.data?.detail || error?.message || "Failed to fetch org admins",
    });
  }
}


