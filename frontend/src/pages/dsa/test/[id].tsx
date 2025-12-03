import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import axios from "axios";

const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default function DSATestVerifyPage() {
  const router = useRouter();
  const { id: testId } = router.query;
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");
  const [userInfo, setUserInfo] = useState<{user_id: string, name: string, email: string} | null>(null);
  const [checkingToken, setCheckingToken] = useState(true);

  useEffect(() => {
    if (!testId) return;
    
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) {
      setError("Invalid test link - token missing");
      setCheckingToken(false);
      return;
    }

    // Verify the link token
    const verifyLink = async () => {
      try {
        const response = await axios.get(`${apiUrl}/api/dsa/tests/${testId}/verify-link?token=${encodeURIComponent(token)}`);
        setUserInfo({
          user_id: response.data.user_id,
          name: response.data.name,
          email: response.data.email
        });
        setName(response.data.name);
        setEmail(response.data.email);
        setError("");
      } catch (err: any) {
        setError(err.response?.data?.detail || "Invalid test link");
      } finally {
        setCheckingToken(false);
      }
    };

    verifyLink();
  }, [testId]);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (verifying) return;
    
    setVerifying(true);
    setError("");

    try {
      if (!userInfo) {
        setError("Please wait for the link to be verified");
        setVerifying(false);
        return;
      }
      
      if (name.trim().toLowerCase() !== userInfo.name.toLowerCase() || 
          email.trim().toLowerCase() !== userInfo.email.toLowerCase()) {
        setError("Name and email do not match the candidate record");
        setVerifying(false);
        return;
      }

      const token = new URLSearchParams(window.location.search).get("token");
      if (!token) {
        setError("Token missing");
        setVerifying(false);
        return;
      }

      // Start the test
      await axios.post(`${apiUrl}/api/dsa/tests/${testId}/start?user_id=${userInfo.user_id}`);
      
      // Redirect to test taking interface
      router.push(`/dsa/test/${testId}/take?token=${encodeURIComponent(token)}&user_id=${encodeURIComponent(userInfo.user_id)}`);
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to start test");
      setVerifying(false);
    }
  };

  if (checkingToken) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "#0f172a" }}>
        <div style={{ textAlign: "center", color: "#94a3b8" }}>
          <div style={{ marginBottom: "1rem" }}>Loading...</div>
        </div>
      </div>
    );
  }

  if (error && !userInfo) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "#0f172a", padding: "1rem" }}>
        <div className="card" style={{ maxWidth: "500px", width: "100%" }}>
          <div style={{ padding: "1.5rem" }}>
            <h2 style={{ color: "#ef4444", marginBottom: "1rem" }}>Invalid Test Link</h2>
            <p style={{ color: "#94a3b8" }}>{error}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "#0f172a", padding: "1rem" }}>
      <div className="card" style={{ maxWidth: "500px", width: "100%" }}>
        <div style={{ padding: "1.5rem" }}>
          <h1 style={{ marginBottom: "1.5rem", color: "#ffffff" }}>Verify Your Identity</h1>
          <form onSubmit={handleVerify} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div>
              <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#e2e8f0" }}>
                Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="Enter your name"
                style={{
                  width: "100%",
                  padding: "0.75rem",
                  border: "1px solid #334155",
                  borderRadius: "0.375rem",
                  backgroundColor: "#1e293b",
                  color: "#ffffff",
                }}
              />
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#e2e8f0" }}>
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="Enter your email"
                style={{
                  width: "100%",
                  padding: "0.75rem",
                  border: "1px solid #334155",
                  borderRadius: "0.375rem",
                  backgroundColor: "#1e293b",
                  color: "#ffffff",
                }}
              />
            </div>
            {error && (
              <div style={{ padding: "0.75rem", backgroundColor: "#7f1d1d", color: "#fca5a5", borderRadius: "0.375rem", fontSize: "0.875rem" }}>
                {error}
              </div>
            )}
            <button
              type="submit"
              className="btn-primary"
              disabled={verifying}
              style={{ width: "100%" }}
            >
              {verifying ? "Verifying..." : "Start Test"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

