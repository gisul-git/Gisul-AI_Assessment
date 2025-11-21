import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { GetServerSideProps } from "next";
import { requireAuth } from "../../../lib/auth";
import Link from "next/link";
import axios from "axios";

interface CandidateResult {
  email: string;
  name: string;
  score: number;
  maxScore: number;
  attempted: number;
  notAttempted: number;
  correctAnswers: number;
  submittedAt: string;
}

interface AnswerLog {
  answer: string;
  questionType: string;
  timestamp: string;
  version: number;
}

interface QuestionLog {
  questionIndex: number;
  questionText: string;
  questionType: string;
  logs: AnswerLog[];
}

export default function AssessmentDetailPage() {
  const router = useRouter();
  const { id } = router.query;
  const [assessment, setAssessment] = useState<any>(null);
  const [candidateResults, setCandidateResults] = useState<CandidateResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [resultsError, setResultsError] = useState<string | null>(null);
  const [loadingResults, setLoadingResults] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState<{ email: string; name: string } | null>(null);
  const [answerLogs, setAnswerLogs] = useState<QuestionLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);

  useEffect(() => {
    if (id) {
      fetchAssessment();
    }
  }, [id]);

  const fetchAssessment = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await axios.get(`/api/assessments/get-questions?assessmentId=${id}`);
      if (response.data?.success && response.data?.data) {
        setAssessment(response.data.data);
      }
      
      // Fetch candidate results
      setLoadingResults(true);
      setResultsError(null);
      try {
        const resultsResponse = await axios.get(`/api/assessments/get-candidate-results?assessmentId=${id}`);
        if (resultsResponse.data?.success) {
          setCandidateResults(resultsResponse.data.data || []);
        } else {
          setResultsError(resultsResponse.data?.message || "Failed to load candidate results");
        }
      } catch (err: any) {
        console.error("Error fetching candidate results:", err);
        setResultsError(err.response?.data?.message || err.message || "Failed to load candidate results");
      } finally {
        setLoadingResults(false);
      }
    } catch (err: any) {
      console.error("Error fetching assessment:", err);
      setError(err.response?.data?.message || err.message || "Failed to load assessment");
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "ready":
        return "#10b981";
      case "draft":
        return "#f59e0b";
      case "scheduled":
        return "#3b82f6";
      case "active":
        return "#8b5cf6";
      default:
        return "#6b7280";
    }
  };

  if (loading) {
    return (
      <div className="container">
        <div className="card">
          <p style={{ textAlign: "center", color: "#475569" }}>Loading assessment...</p>
        </div>
      </div>
    );
  }

  if (error || !assessment) {
    return (
      <div className="container">
        <div className="card">
          <div className="alert alert-error">{error || "Assessment not found"}</div>
          <Link href="/dashboard">
            <button type="button" className="btn-secondary" style={{ marginTop: "1rem" }}>
              Back to Dashboard
            </button>
          </Link>
        </div>
      </div>
    );
  }

  const totalQuestions = assessment.questions?.length || 0;
  const topicsCount = assessment.topics?.length || 0;

  return (
    <div className="container">
      <div className="card">
        <div style={{ marginBottom: "2rem" }}>
          <Link href="/dashboard" style={{ color: "#3b82f6", textDecoration: "none" }}>
            ← Back to Dashboard
          </Link>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: "2rem" }}>
          <div>
            <h1 style={{ margin: 0, marginBottom: "0.5rem" }}>{assessment.assessment?.title || "Untitled Assessment"}</h1>
            <p style={{ color: "#475569", margin: 0 }}>{assessment.assessment?.description || "No description"}</p>
          </div>
          <span
            style={{
              backgroundColor: getStatusColor(assessment.assessment?.status || "draft") + "20",
              color: getStatusColor(assessment.assessment?.status || "draft"),
              padding: "0.5rem 1rem",
              borderRadius: "9999px",
              fontSize: "0.875rem",
              fontWeight: 600,
              textTransform: "capitalize",
            }}
          >
            {assessment.assessment?.status || "draft"}
          </span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1.5rem", marginBottom: "2rem" }}>
          <div style={{ backgroundColor: "#f8fafc", padding: "1.5rem", borderRadius: "0.75rem", border: "1px solid #e2e8f0" }}>
            <h3 style={{ margin: 0, color: "#0f172a", fontSize: "1.125rem" }}>Topics</h3>
            <p style={{ marginTop: "0.5rem", color: "#475569", fontSize: "1.5rem", fontWeight: 600 }}>
              {topicsCount}
            </p>
          </div>
          <div style={{ backgroundColor: "#f8fafc", padding: "1.5rem", borderRadius: "0.75rem", border: "1px solid #e2e8f0" }}>
            <h3 style={{ margin: 0, color: "#0f172a", fontSize: "1.125rem" }}>Questions</h3>
            <p style={{ marginTop: "0.5rem", color: "#475569", fontSize: "1.5rem", fontWeight: 600 }}>
              {totalQuestions}
            </p>
          </div>
        </div>

        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "2rem" }}>
          {assessment.assessment?.status === "draft" && (
            <>
              <Link href={`/assessments/${id}/configure`}>
                <button type="button" className="btn-secondary">
                  Configure Topics
                </button>
              </Link>
              <Link href={`/assessments/${id}/questions`}>
                <button type="button" className="btn-primary">
                  {totalQuestions > 0 ? "View Questions" : "Generate Questions"}
                </button>
              </Link>
            </>
          )}
          {assessment.assessment?.status === "ready" && (
            <Link href={`/assessments/${id}/questions`}>
              <button type="button" className="btn-primary">
                View Questions
              </button>
            </Link>
          )}
          <button
            type="button"
            onClick={() => {
              setShowResults(!showResults);
              if (showResults) {
                setSelectedCandidate(null);
                setAnswerLogs([]);
              }
            }}
            className="btn-secondary"
            disabled={loadingResults}
          >
            {loadingResults
              ? "Loading Results..."
              : showResults
              ? "Hide"
              : "Show"} Candidate Results {!loadingResults && `(${candidateResults.length})`}
          </button>
        </div>

        {/* Candidate Results Section */}
        {showResults && (
          <div style={{ marginTop: "2rem", paddingTop: "2rem", borderTop: "2px solid #e2e8f0" }}>
            <h2 style={{ marginBottom: "1.5rem", fontSize: "1.5rem", color: "#1a1625", fontWeight: 700 }}>
              Candidate Results
            </h2>
            
            {loadingResults ? (
              <div style={{ textAlign: "center", padding: "2rem" }}>
                <p style={{ color: "#64748b" }}>Loading candidate results...</p>
              </div>
            ) : resultsError ? (
              <div className="alert alert-error" style={{ marginBottom: "1rem" }}>
                {resultsError}
                <button
                  type="button"
                  onClick={fetchAssessment}
                  className="btn-secondary"
                  style={{ marginTop: "0.5rem" }}
                >
                  Retry
                </button>
              </div>
            ) : candidateResults.length === 0 ? (
              <div style={{ textAlign: "center", padding: "2rem", color: "#64748b" }}>
                <p>No candidate results yet. Results will appear here once candidates submit their assessments.</p>
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ backgroundColor: "#f8fafc" }}>
                      <th style={{ padding: "1rem", textAlign: "left", borderBottom: "2px solid #e2e8f0", fontWeight: 600, color: "#1e293b" }}>
                        Candidate Name
                      </th>
                      <th style={{ padding: "1rem", textAlign: "left", borderBottom: "2px solid #e2e8f0", fontWeight: 600, color: "#1e293b" }}>
                        Email
                      </th>
                      <th style={{ padding: "1rem", textAlign: "left", borderBottom: "2px solid #e2e8f0", fontWeight: 600, color: "#1e293b" }}>
                        Score
                      </th>
                      <th style={{ padding: "1rem", textAlign: "left", borderBottom: "2px solid #e2e8f0", fontWeight: 600, color: "#1e293b" }}>
                        Attempted
                      </th>
                      <th style={{ padding: "1rem", textAlign: "left", borderBottom: "2px solid #e2e8f0", fontWeight: 600, color: "#1e293b" }}>
                        Not Attempted
                      </th>
                      <th style={{ padding: "1rem", textAlign: "left", borderBottom: "2px solid #e2e8f0", fontWeight: 600, color: "#1e293b" }}>
                        Correct Answers
                      </th>
                      <th style={{ padding: "1rem", textAlign: "left", borderBottom: "2px solid #e2e8f0", fontWeight: 600, color: "#1e293b" }}>
                        Submitted At
                      </th>
                      <th style={{ padding: "1rem", textAlign: "left", borderBottom: "2px solid #e2e8f0", fontWeight: 600, color: "#1e293b" }}>
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {candidateResults.map((result, index) => (
                      <tr key={index} style={{ borderBottom: "1px solid #e2e8f0" }}>
                        <td style={{ padding: "1rem" }}>{result.name}</td>
                        <td style={{ padding: "1rem" }}>{result.email}</td>
                        <td style={{ padding: "1rem" }}>
                          <span style={{ fontWeight: 600, color: "#1e293b" }}>
                            {result.score} / {result.maxScore}
                          </span>
                          <span style={{ marginLeft: "0.5rem", color: "#64748b", fontSize: "0.875rem" }}>
                            ({result.maxScore > 0 ? Math.round((result.score / result.maxScore) * 100) : 0}%)
                          </span>
                        </td>
                        <td style={{ padding: "1rem" }}>
                          <span style={{ color: "#10b981", fontWeight: 600 }}>{result.attempted}</span>
                        </td>
                        <td style={{ padding: "1rem" }}>
                          <span style={{ color: "#ef4444", fontWeight: 600 }}>{result.notAttempted}</span>
                        </td>
                        <td style={{ padding: "1rem" }}>
                          <span style={{ color: "#3b82f6", fontWeight: 600 }}>{result.correctAnswers}</span>
                        </td>
                        <td style={{ padding: "1rem", fontSize: "0.875rem", color: "#64748b" }}>
                          {result.submittedAt
                            ? new Date(result.submittedAt).toLocaleString("en-IN", {
                                timeZone: "Asia/Kolkata",
                                year: "numeric",
                                month: "short",
                                day: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                            : "N/A"}
                        </td>
                        <td style={{ padding: "1rem" }}>
                          <button
                            type="button"
                            onClick={async () => {
                              setSelectedCandidate({ email: result.email, name: result.name });
                              setLoadingLogs(true);
                              setLogsError(null);
                              try {
                                const candidateEmail = result.email;
                                const candidateName = result.name;
                                const candidateKey = `${candidateEmail.trim().toLowerCase()}_${candidateName.trim()}`;
                                const logsResponse = await axios.get(
                                  `/api/assessments/get-answer-logs?assessmentId=${id}&candidateEmail=${encodeURIComponent(candidateEmail)}&candidateName=${encodeURIComponent(candidateName)}`
                                );
                                if (logsResponse.data?.success) {
                                  const logsData = logsResponse.data.data || [];
                                  setAnswerLogs(logsData);
                                } else {
                                  setLogsError(logsResponse.data?.message || logsResponse.data?.detail || "Failed to load answer logs");
                                }
                              } catch (err: any) {
                                console.error("Error fetching answer logs:", err);
                                const errorMsg = err.response?.data?.message || 
                                                err.response?.data?.detail || 
                                                err.response?.data?.error ||
                                                err.message || 
                                                "Failed to load answer logs";
                                setLogsError(errorMsg);
                                console.error("Full error response:", err.response?.data);
                              } finally {
                                setLoadingLogs(false);
                              }
                            }}
                            className="btn-secondary"
                            style={{ 
                              padding: "0.5rem 1rem", 
                              fontSize: "0.875rem",
                              whiteSpace: "nowrap"
                            }}
                          >
                            View Logs
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Answer Logs Section */}
            {selectedCandidate && (
              <div style={{ marginTop: "2rem", paddingTop: "2rem", borderTop: "2px solid #e2e8f0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
                  <h2 style={{ margin: 0, fontSize: "1.5rem", color: "#1a1625", fontWeight: 700 }}>
                    Answer Logs - {selectedCandidate.name}
                  </h2>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCandidate(null);
                      setAnswerLogs([]);
                    }}
                    className="btn-secondary"
                    style={{ padding: "0.5rem 1rem", fontSize: "0.875rem" }}
                  >
                    Close
                  </button>
                </div>

                {loadingLogs ? (
                  <div style={{ textAlign: "center", padding: "2rem" }}>
                    <p style={{ color: "#64748b" }}>Loading answer logs...</p>
                  </div>
                ) : logsError ? (
                  <div className="alert alert-error" style={{ marginBottom: "1rem" }}>
                    {logsError}
                  </div>
                ) : answerLogs.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "2rem", color: "#64748b" }}>
                    <p>No answer logs found for this candidate.</p>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
                    {answerLogs.map((questionLog) => (
                      <div
                        key={questionLog.questionIndex}
                        style={{
                          border: "1px solid #e2e8f0",
                          borderRadius: "0.75rem",
                          padding: "1.5rem",
                          backgroundColor: "#ffffff",
                        }}
                      >
                        <div style={{ marginBottom: "1rem" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
                            <span
                              style={{
                                backgroundColor: "#6953a3",
                                color: "#ffffff",
                                padding: "0.25rem 0.75rem",
                                borderRadius: "9999px",
                                fontSize: "0.75rem",
                                fontWeight: 700,
                              }}
                            >
                              Q{questionLog.questionIndex + 1}
                            </span>
                            <span
                              style={{
                                backgroundColor: "#eff6ff",
                                color: "#1e40af",
                                padding: "0.25rem 0.75rem",
                                borderRadius: "9999px",
                                fontSize: "0.75rem",
                                fontWeight: 600,
                              }}
                            >
                              {questionLog.questionType}
                            </span>
                          </div>
                          <p style={{ color: "#1e293b", lineHeight: 1.6, margin: 0, fontSize: "0.9375rem" }}>
                            {questionLog.questionText}
                          </p>
                        </div>

                        <div style={{ marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid #e2e8f0" }}>
                          <h4 style={{ margin: 0, marginBottom: "1rem", fontSize: "1rem", color: "#1e293b", fontWeight: 600 }}>
                            Answer Versions:
                          </h4>
                          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                            {questionLog.logs.map((log, logIndex) => (
                              <div
                                key={logIndex}
                                style={{
                                  padding: "1rem",
                                  backgroundColor: "#f8fafc",
                                  border: "1px solid #e2e8f0",
                                  borderRadius: "0.5rem",
                                }}
                              >
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: "0.5rem" }}>
                                  <span
                                    style={{
                                      backgroundColor: "#dbeafe",
                                      color: "#1e40af",
                                      padding: "0.25rem 0.75rem",
                                      borderRadius: "9999px",
                                      fontSize: "0.75rem",
                                      fontWeight: 600,
                                    }}
                                  >
                                    Version {log.version}
                                  </span>
                                  <span style={{ fontSize: "0.75rem", color: "#64748b" }}>
                                    {new Date(log.timestamp).toLocaleString("en-IN", {
                                      timeZone: "Asia/Kolkata",
                                      year: "numeric",
                                      month: "short",
                                      day: "numeric",
                                      hour: "2-digit",
                                      minute: "2-digit",
                                      second: "2-digit",
                                    })}
                                  </span>
                                </div>
                                <p
                                  style={{
                                    color: "#1e293b",
                                    lineHeight: 1.6,
                                    whiteSpace: "pre-wrap",
                                    margin: 0,
                                    fontSize: "0.875rem",
                                  }}
                                >
                                  {log.answer || "(Empty answer)"}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Server-side authentication check
export const getServerSideProps: GetServerSideProps = requireAuth;

