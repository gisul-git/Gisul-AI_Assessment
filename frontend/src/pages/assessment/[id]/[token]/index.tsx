import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import axios from "axios";
import Link from "next/link";

export default function CandidateEntryPage() {
  const router = useRouter();
  const { id, token } = router.query;
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    console.log("[CandidateEntry] Router query params:", router.query);
  }, [router.query]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email.trim() || !name.trim()) {
      setError("Please enter both email and name");
      return;
    }

    setLoading(true);
    setError(null);

    const payload = {
      assessmentId: id,
      token,
      email: email.trim(),
      name: name.trim(),
    };

    console.log("[CandidateEntry] Submitting verification payload:", payload);

    try {
      const response = await axios.post("/api/assessment/verify-candidate", {
        assessmentId: id,
        token,
        email: email.trim(),
        name: name.trim(),
      });

      console.log("[CandidateEntry] Verification response:", response.status, response.data);

      if (response.data?.success) {
        // Store candidate info in sessionStorage
        sessionStorage.setItem("candidateEmail", email.trim());
        sessionStorage.setItem("candidateName", name.trim());
        // Redirect to assessment page
        router.push(`/assessment/${id}/${token}/take`);
      } else {
        console.warn("[CandidateEntry] Verification failed with message:", response.data?.message);
        setError(response.data?.message || "Invalid credentials");
      }
    } catch (err: any) {
      console.error("[CandidateEntry] Error verifying candidate:", {
        message: err?.message,
        status: err?.response?.status,
        data: err?.response?.data,
        configUrl: err?.config?.url,
      });
      setError(err.response?.data?.message || err.message || "Failed to verify. Please check your email and name.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ backgroundColor: "#f1dcba", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem" }}>
      <div className="card" style={{ maxWidth: "500px", width: "100%" }}>
        <h1 style={{ marginBottom: "0.5rem", fontSize: "2rem", color: "#1a1625", fontWeight: 700, textAlign: "center" }}>
          Assessment Entry
        </h1>
        <p style={{ color: "#6b6678", marginBottom: "2rem", fontSize: "1rem", textAlign: "center" }}>
          Please enter your email and name to access the assessment
        </p>

        {error && (
          <div className="alert alert-error" style={{ marginBottom: "1.5rem" }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: "1.5rem" }}>
            <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1e293b" }}>
              Email *
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your email"
              required
              style={{
                width: "100%",
                padding: "0.75rem",
                border: "1px solid #e2e8f0",
                borderRadius: "0.5rem",
                fontSize: "1rem",
              }}
            />
          </div>

          <div style={{ marginBottom: "1.5rem" }}>
            <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1e293b" }}>
              Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter your name"
              required
              style={{
                width: "100%",
                padding: "0.75rem",
                border: "1px solid #e2e8f0",
                borderRadius: "0.5rem",
                fontSize: "1rem",
              }}
            />
          </div>

          <button
            type="submit"
            className="btn-primary"
            disabled={loading || !email.trim() || !name.trim()}
            style={{ width: "100%", marginTop: "1rem" }}
          >
            {loading ? "Verifying..." : "Continue to Assessment"}
          </button>
        </form>
      </div>
    </div>
  );
}

