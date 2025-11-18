import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import axios from "axios";

export default function CandidateAssessmentPage() {
  const router = useRouter();
  const { id, token } = router.query;
  const [startTime, setStartTime] = useState<string | null>(null);
  const [endTime, setEndTime] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [candidateEmail, setCandidateEmail] = useState<string | null>(null);
  const [candidateName, setCandidateName] = useState<string | null>(null);

  useEffect(() => {
    // Get candidate info from localStorage
    const email = localStorage.getItem("candidateEmail");
    const name = localStorage.getItem("candidateName");
    
    if (!email || !name) {
      // Redirect back to entry page if not verified
      router.push(`/assessment/${id}/${token}`);
      return;
    }

    setCandidateEmail(email);
    setCandidateName(name);

    // Fetch assessment schedule
    const fetchSchedule = async () => {
      try {
        const response = await axios.get(`/api/assessment/get-schedule?assessmentId=${id}&token=${token}`);
        if (response.data?.success) {
          setStartTime(response.data.data.startTime);
          setEndTime(response.data.data.endTime);
        } else {
          setError("Failed to load assessment schedule");
        }
      } catch (err: any) {
        console.error("Error fetching schedule:", err);
        setError("Failed to load assessment schedule");
      } finally {
        setLoading(false);
      }
    };

    if (id && token) {
      fetchSchedule();
    }
  }, [id, token, router]);

  const formatDateTime = (dateTime: string | null) => {
    if (!dateTime) return "Not set";
    const date = new Date(dateTime);
    return date.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }) + " IST";
  };

  if (loading) {
    return (
      <div style={{ backgroundColor: "#f1dcba", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="card">
          <p style={{ textAlign: "center", color: "#475569" }}>Loading assessment...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ backgroundColor: "#f1dcba", minHeight: "100vh", padding: "2rem" }}>
      <div className="container">
        <div className="card">
          <h1 style={{ marginBottom: "0.5rem", fontSize: "2rem", color: "#1a1625", fontWeight: 700 }}>
            Assessment
          </h1>
          
          {candidateName && (
            <p style={{ color: "#6b6678", marginBottom: "2rem", fontSize: "1rem" }}>
              Welcome, {candidateName}
            </p>
          )}

          {error && (
            <div className="alert alert-error" style={{ marginBottom: "1.5rem" }}>
              {error}
            </div>
          )}

          <div style={{ marginBottom: "2rem", padding: "1.5rem", backgroundColor: "#f8fafc", borderRadius: "0.75rem", border: "1px solid #e2e8f0" }}>
            <h2 style={{ marginBottom: "1rem", fontSize: "1.25rem", color: "#1a1625", fontWeight: 600 }}>
              Assessment Schedule
            </h2>
            <div style={{ marginBottom: "1rem" }}>
              <p style={{ marginBottom: "0.5rem", color: "#64748b", fontSize: "0.875rem" }}>Start Time:</p>
              <p style={{ fontSize: "1.125rem", color: "#1e293b", fontWeight: 600 }}>
                {formatDateTime(startTime)}
              </p>
            </div>
            <div>
              <p style={{ marginBottom: "0.5rem", color: "#64748b", fontSize: "0.875rem" }}>End Time:</p>
              <p style={{ fontSize: "1.125rem", color: "#1e293b", fontWeight: 600 }}>
                {formatDateTime(endTime)}
              </p>
            </div>
          </div>

          <div style={{ padding: "2rem", textAlign: "center", color: "#64748b" }}>
            <p>Assessment questions will be available here in the future.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

