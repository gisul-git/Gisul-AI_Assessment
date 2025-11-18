import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import fastApiClient from "../../../lib/fastapi";

interface UpdateScheduleAndCandidatesPayload {
  assessmentId: string;
  startTime: string;
  endTime: string;
  candidates: Array<{ email: string; name: string }>;
  assessmentUrl: string;
  token: string;
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

  const payload = req.body as UpdateScheduleAndCandidatesPayload;

  if (!payload.assessmentId || !payload.startTime || !payload.endTime || !payload.candidates || payload.candidates.length === 0) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  try {
    const token = (session as any)?.backendToken;
    const response = await fastApiClient.post(
      "/api/assessments/update-schedule-and-candidates",
      payload,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );
    return res.status(response.status || 200).json(response.data);
  } catch (error: any) {
    console.error("Error in update-schedule-and-candidates API route:", error);
    const statusCode = error?.response?.status || 500;
    const errorMessage =
      error?.response?.data?.detail ||
      error?.response?.data?.message ||
      error?.message ||
      "Failed to update schedule and candidates";
    return res.status(statusCode).json({
      message: errorMessage,
    });
  }
}

