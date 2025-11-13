import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import fastApiClient from "@/lib/fastapi";

interface GenerateTopicsPayload {
  jobRole: string;
  experience: string;
  skills: string[];
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method Not Allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const { jobRole, experience, skills } = req.body as GenerateTopicsPayload;

  if (!jobRole || !experience || !skills || skills.length === 0) {
    return res.status(400).json({ message: "Job role, experience, and skills are required" });
  }

  try {
    const token = (session as any)?.backendToken;
    const response = await fastApiClient.post(
      "/api/assessments/generate-topics",
      { jobRole, experience, skills },
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );
    return res.status(response.status || 200).json(response.data);
  } catch (error: any) {
    console.error("Error in generate-topics API route:", error);
    const statusCode = error?.response?.status || 500;
    const errorMessage =
      error?.response?.data?.detail ||
      error?.response?.data?.message ||
      error?.message ||
      "Failed to generate topics";
    return res.status(statusCode).json({
      message: errorMessage,
    });
  }
}

