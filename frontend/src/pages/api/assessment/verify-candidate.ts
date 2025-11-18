import type { NextApiRequest, NextApiResponse } from "next";
import fastApiClient from "../../../lib/fastapi";

interface VerifyCandidatePayload {
  assessmentId: string;
  token: string;
  email: string;
  name: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method Not Allowed" });
  }

  const payload = req.body as VerifyCandidatePayload;

  if (!payload.assessmentId || !payload.token || !payload.email || !payload.name) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  try {
    const response = await fastApiClient.post(
      "/api/assessment/verify-candidate",
      payload
    );
    return res.status(response.status || 200).json(response.data);
  } catch (error: any) {
    console.error("Error in verify-candidate API route:", error);
    const statusCode = error?.response?.status || 500;
    const errorMessage =
      error?.response?.data?.detail ||
      error?.response?.data?.message ||
      error?.message ||
      "Failed to verify candidate";
    return res.status(statusCode).json({
      message: errorMessage,
    });
  }
}

