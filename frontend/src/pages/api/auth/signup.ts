import type { NextApiRequest, NextApiResponse } from "next";

import fastApiClient from "@/lib/fastapi";

interface SignupPayload {
  name: string;
  email: string;
  password: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method Not Allowed" });
  }

  const { name, email, password } = req.body as SignupPayload;

  if (!name || !email || !password) {
    return res.status(400).json({ message: "Name, email, and password are required" });
  }

  try {
    const response = await fastApiClient.post("/api/auth/org-signup-email", {
      name,
      email,
      password,
    });
    return res.status(response.status).json(response.data);
  } catch (error: any) {
    return res.status(500).json({ message: error?.message ?? "Signup failed" });
  }
}


