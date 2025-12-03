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
  aiScore?: number;
  percentageScored?: number;
  passPercentage?: number;
  passed?: boolean;
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
  aiScore?: number;
  aiFeedback?: string;
  maxScore?: number;
  isMcqCorrect?: boolean;
  correctAnswer?: string;
  options?: string[];
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
            <Link href="/assessments/create-new">
              <button type="button" className="btn-primary">
                Create
              </button>
            </Link>
          )}
          {assessment.assessment?.status !== "draft" && (
            <>
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
              
              {/* Live Proctoring Button - Monitor all candidates at once */}
              <Link href={`/admin/assessment/${id}/live-proctoring`}>
                <button
                  type="button"
                  style={{
                    padding: "0.75rem 1.25rem",
                    backgroundColor: "#dc2626",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "0.5rem",
                    fontSize: "0.9375rem",
                    fontWeight: 600,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                    <circle cx="12" cy="13" r="4" />
                  </svg>
                  Live Proctoring
                </button>
              </Link>
            </>
          )}
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
                        AI Score
                      </th>
                      <th style={{ padding: "1rem", textAlign: "left", borderBottom: "2px solid #e2e8f0", fontWeight: 600, color: "#1e293b" }}>
                        Percentage
                      </th>
                      <th style={{ padding: "1rem", textAlign: "left", borderBottom: "2px solid #e2e8f0", fontWeight: 600, color: "#1e293b" }}>
                        Status
                      </th>
                      <th style={{ padding: "1rem", textAlign: "left", borderBottom: "2px solid #e2e8f0", fontWeight: 600, color: "#1e293b" }}>
                        Attempted
                      </th>
                      <th style={{ padding: "1rem", textAlign: "left", borderBottom: "2px solid #e2e8f0", fontWeight: 600, color: "#1e293b" }}>
                        Not Attempted
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
                            {result.aiScore !== undefined ? result.aiScore : result.score} / {result.maxScore}
                          </span>
                        </td>
                        <td style={{ padding: "1rem" }}>
                          <span style={{ fontWeight: 600, color: "#1e293b" }}>
                            {result.percentageScored !== undefined ? result.percentageScored.toFixed(2) : (result.maxScore > 0 ? Math.round((result.score / result.maxScore) * 100) : 0)}%
                          </span>
                        </td>
                        <td style={{ padding: "1rem" }}>
                          {result.passed !== undefined ? (
                            <span
                              style={{
                                padding: "0.25rem 0.75rem",
                                borderRadius: "9999px",
                                fontSize: "0.875rem",
                                fontWeight: 600,
                                backgroundColor: result.passed ? "#d1fae5" : "#fee2e2",
                                color: result.passed ? "#065f46" : "#991b1b",
                              }}
                            >
                              {result.passed ? "Pass" : "Fail"}
                            </span>
                          ) : (
                            <span style={{ color: "#64748b" }}>N/A</span>
                          )}
                        </td>
                        <td style={{ padding: "1rem" }}>
                          <span style={{ color: "#10b981", fontWeight: 600 }}>{result.attempted}</span>
                        </td>
                        <td style={{ padding: "1rem" }}>
                          <span style={{ color: "#ef4444", fontWeight: 600 }}>{result.notAttempted}</span>
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
                          <div style={{ display: "flex", gap: "0.5rem" }}>
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
                            <Link href={`/admin/assessment/${id}/candidate/${encodeURIComponent(result.email)}`}>
                              <button
                                type="button"
                                className="btn-secondary"
                                style={{ 
                                  padding: "0.5rem 1rem", 
                                  fontSize: "0.875rem",
                                  whiteSpace: "nowrap",
                                  backgroundColor: "#fef2f2",
                                  borderColor: "#fecaca",
                                  color: "#dc2626"
                                }}
                              >
                                Proctoring
                              </button>
                            </Link>
                          </div>
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
                          
                          {/* MCQ Options Display */}
                          {questionLog.questionType === "MCQ" && questionLog.options && questionLog.options.length > 0 && (
                            <div style={{ marginTop: "1rem" }}>
                              <h4 style={{ margin: 0, marginBottom: "0.75rem", fontSize: "0.875rem", color: "#64748b", fontWeight: 600 }}>
                                Options:
                              </h4>
                              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                                {questionLog.options.map((option, optIndex) => {
                                  const optionLetter = String.fromCharCode(65 + optIndex); // A, B, C, D, etc.
                                  const isSelected = questionLog.logs.length > 0 && questionLog.logs[questionLog.logs.length - 1]?.answer === optionLetter;
                                  const isCorrect = optionLetter === questionLog.correctAnswer;
                                  const showAsCorrect = isSelected && isCorrect;
                                  const showAsWrong = isSelected && !isCorrect;
                                  
                                  return (
                                    <div
                                      key={optIndex}
                                      style={{
                                        padding: "0.75rem",
                                        backgroundColor: showAsCorrect ? "#d1fae5" : showAsWrong ? "#fee2e2" : "#f8fafc",
                                        border: `2px solid ${showAsCorrect ? "#10b981" : showAsWrong ? "#ef4444" : "#e2e8f0"}`,
                                        borderRadius: "0.5rem",
                                        display: "flex",
                                        alignItems: "center",
                                        gap: "0.5rem",
                                      }}
                                    >
                                      <span
                                        style={{
                                          fontWeight: 700,
                                          color: showAsCorrect ? "#059669" : showAsWrong ? "#dc2626" : "#64748b",
                                          fontSize: "0.875rem",
                                          minWidth: "24px",
                                        }}
                                      >
                                        {optionLetter}.
                                      </span>
                                      <span style={{ flex: 1, color: "#1e293b", fontSize: "0.875rem" }}>
                                        {option}
                                      </span>
                                      {showAsCorrect && (
                                        <span style={{ color: "#059669", fontWeight: 700, fontSize: "0.875rem" }}>
                                          ✓ Correct
                                        </span>
                                      )}
                                      {showAsWrong && (
                                        <span style={{ color: "#dc2626", fontWeight: 700, fontSize: "0.875rem" }}>
                                          ✗ Selected (Wrong)
                                        </span>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                              {questionLog.isMcqCorrect !== undefined && (
                                <div style={{ marginTop: "0.75rem", padding: "0.75rem", backgroundColor: questionLog.isMcqCorrect ? "#f0fdf4" : "#fef2f2", border: `1px solid ${questionLog.isMcqCorrect ? "#10b981" : "#ef4444"}`, borderRadius: "0.5rem" }}>
                                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                    <span style={{ fontWeight: 600, color: questionLog.isMcqCorrect ? "#065f46" : "#991b1b", fontSize: "0.875rem" }}>
                                      Answer Status:
                                    </span>
                                    <span style={{ fontWeight: 700, color: questionLog.isMcqCorrect ? "#059669" : "#dc2626", fontSize: "1rem" }}>
                                      {questionLog.isMcqCorrect ? "✓ Correct" : "✗ Incorrect"}
                                    </span>
                                  </div>
                                  {!questionLog.isMcqCorrect && questionLog.correctAnswer && (
                                    <p style={{ marginTop: "0.5rem", marginBottom: 0, fontSize: "0.875rem", color: "#991b1b", fontWeight: 600 }}>
                                      Correct Answer: {questionLog.correctAnswer}
                                    </p>
                                  )}
                                  {questionLog.aiScore !== undefined && (
                                    <p style={{ marginTop: "0.5rem", marginBottom: 0, fontSize: "0.875rem", color: questionLog.isMcqCorrect ? "#047857" : "#991b1b", fontWeight: 600 }}>
                                      Score: {questionLog.aiScore} / {questionLog.maxScore || 5} points
                                    </p>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                          {/* AI Score for non-MCQ questions */}
                          {questionLog.questionType !== "MCQ" && questionLog.aiScore !== undefined && (
                            <div style={{ marginTop: "0.75rem", padding: "0.75rem", backgroundColor: "#f0fdf4", border: "1px solid #10b981", borderRadius: "0.5rem" }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <span style={{ fontWeight: 600, color: "#065f46", fontSize: "0.875rem" }}>
                                  AI Evaluated Score (Last Version):
                                </span>
                                <span style={{ fontWeight: 700, color: "#059669", fontSize: "1rem" }}>
                                  {questionLog.aiScore} / {questionLog.maxScore || 5} points
                                </span>
                              </div>
                              {questionLog.aiFeedback && (
                                <p style={{ marginTop: "0.5rem", marginBottom: 0, fontSize: "0.875rem", color: "#047857" }}>
                                  {questionLog.aiFeedback}
                                </p>
                              )}
                            </div>
                          )}
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

