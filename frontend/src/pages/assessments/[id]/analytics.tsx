'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/router'
import { useSession } from 'next-auth/react'
import { GetServerSideProps } from 'next'
import { requireAuth } from '../../../lib/auth'
import Link from 'next/link'
import axios from 'axios'
import { ArrowLeft, AlertTriangle, Clock, Video } from 'lucide-react'
import { MultiProctorGrid } from '@/components/proctor/MultiProctorGrid'
import { useMultiLiveProctorAdmin } from '@/hooks/useMultiLiveProctorAdmin'

interface AnswerLog {
  answer: string
  questionType: string
  timestamp: string
  version: number
}

interface QuestionLog {
  questionIndex: number
  questionText: string
  questionType: string
  logs: AnswerLog[]
  aiScore?: number
  aiFeedback?: string
  maxScore?: number
  isMcqCorrect?: boolean
  correctAnswer?: string
  options?: string[]
}

interface Candidate {
  email: string
  name: string
  score: number
  maxScore: number
  attempted: number
  notAttempted: number
  correctAnswers: number
  submittedAt: string | null
  aiScore?: number
  percentageScored?: number
  passPercentage?: number
  passed?: boolean
}

export default function AnalyticsPage() {
  const router = useRouter()
  const { data: session } = useSession()
  const { id: assessmentId, candidate: candidateEmail } = router.query
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [selectedCandidate, setSelectedCandidate] = useState<string | null>(null)
  const [answerLogs, setAnswerLogs] = useState<QuestionLog[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingAnalytics, setLoadingAnalytics] = useState(false)
  const [assessment, setAssessment] = useState<any>(null)
  const [proctorLogs, setProctorLogs] = useState<any[]>([])
  const [eventTypeLabels, setEventTypeLabels] = useState<Record<string, string>>({})
  const [loadingProctorLogs, setLoadingProctorLogs] = useState(false)
  const [showProctorLogs, setShowProctorLogs] = useState(false)
  const [showLiveProctor, setShowLiveProctor] = useState(false)
  const [hasActiveSessions, setHasActiveSessions] = useState(false)
  const isMonitoringRef = useRef(false)
  
  // Multi-proctor hook for viewing all candidates
  const {
    candidateStreams,
    activeCandidates,
    isLoading: isProctorLoading,
    startMonitoring,
    stopMonitoring,
    refreshCandidate,
  } = useMultiLiveProctorAdmin({
    assessmentId: (assessmentId as string) || "",
    adminId: (session as any)?.user?.id || (session as any)?.user?.email || 'admin',
    onError: (error) => {
      console.error('Multi-proctor error:', error)
    },
    debugMode: true,
  })
  
  // Check for active sessions only when live proctor panel is open
  // Use activeCandidates from the hook instead of polling separately
  useEffect(() => {
    if (showLiveProctor && activeCandidates) {
      setHasActiveSessions(activeCandidates.length > 0)
    }
  }, [activeCandidates, showLiveProctor])
  
  // Check for active sessions ONLY when button is clicked (not on mount or hover)
  const checkActiveSessionsOnClick = async (): Promise<boolean> => {
    if (!assessmentId || typeof assessmentId !== 'string') return false
    
    try {
      const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"
      const res = await fetch(`${API_URL}/api/proctor/live/all-sessions/${assessmentId}`)
      const data = await res.json()
      
      if (data.success && data.data?.sessions) {
        const activeSessions = data.data.sessions.filter((s: any) => 
          s.status !== "ended" && s.status !== "completed"
        )
        const hasActive = activeSessions.length > 0
        setHasActiveSessions(hasActive)
        return hasActive
      } else {
        setHasActiveSessions(false)
        return false
      }
    } catch (error) {
      console.error('Error checking active sessions:', error)
      setHasActiveSessions(false)
      return false
    }
  }
  
  
  // Start monitoring when live proctor panel opens, stop when it closes
  // Note: stopMonitoring() only closes local peer connections, it does NOT end sessions on backend
  // This means when admin reopens, it will reconnect to existing sessions without requiring candidate re-acceptance
  useEffect(() => {
    // Only run if assessmentId is valid
    if (!assessmentId || typeof assessmentId !== 'string') return
    
    // Start if panel is open
    if (showLiveProctor) {
      if (!isMonitoringRef.current) {
        console.log('[Live Proctor] Starting monitoring - will reuse existing sessions (no re-acceptance needed)...')
        isMonitoringRef.current = true
        startMonitoring()
      }
    } else {
      // Stop if panel is closed
      if (isMonitoringRef.current) {
        console.log('[Live Proctor] Panel closed, stopping monitoring...')
        isMonitoringRef.current = false
        stopMonitoring()
      }
    }
    
    // Cleanup function - always stop monitoring when component unmounts
    return () => {
      if (isMonitoringRef.current) {
        console.log('[Live Proctor] Stopping monitoring (cleanup on unmount)...')
        isMonitoringRef.current = false
        stopMonitoring()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showLiveProctor, assessmentId]) // Removed startMonitoring and stopMonitoring from deps to prevent re-runs

  const fetchAnalytics = async (email: string, name: string) => {
    if (!assessmentId || typeof assessmentId !== 'string') return
    
    setLoadingAnalytics(true)
    try {
      const logsResponse = await axios.get(
        `/api/assessments/get-answer-logs?assessmentId=${assessmentId}&candidateEmail=${encodeURIComponent(email)}&candidateName=${encodeURIComponent(name)}`
      )
      if (logsResponse.data?.success) {
        setAnswerLogs(logsResponse.data.data || [])
      }
    } catch (error) {
      console.error('Error fetching analytics:', error)
      alert('Failed to load analytics')
    } finally {
      setLoadingAnalytics(false)
    }
  }

  const fetchProctorLogs = async (email: string) => {
    if (!assessmentId || typeof assessmentId !== 'string') return
    
    setLoadingProctorLogs(true)
    try {
      const response = await fetch(`/api/proctor/logs?assessmentId=${encodeURIComponent(assessmentId)}&userId=${encodeURIComponent(email)}`)
      const data = await response.json()
      
      if (data.success && data.data) {
        setProctorLogs(data.data.logs || [])
        setEventTypeLabels(data.data.eventTypeLabels || {})
      } else {
        setProctorLogs([])
        setEventTypeLabels({})
      }
    } catch (error) {
      console.error('Error fetching proctor logs:', error)
      setProctorLogs([])
      setEventTypeLabels({})
    } finally {
      setLoadingProctorLogs(false)
    }
  }

  const hasFetchedRef = useRef<string | null>(null)
  
  useEffect(() => {
    if (!assessmentId || typeof assessmentId !== 'string') return
    
    // Only fetch if assessmentId changed (not on every render)
    if (hasFetchedRef.current === assessmentId) return

    const fetchData = async () => {
      try {
        setLoading(true)
        hasFetchedRef.current = assessmentId
        
        // Fetch assessment details
        const assessmentResponse = await axios.get(`/api/assessments/get-questions?assessmentId=${assessmentId}`)
        if (assessmentResponse.data?.success && assessmentResponse.data?.data) {
          setAssessment(assessmentResponse.data.data)
        }
        
        // Fetch candidate results
        const resultsResponse = await axios.get(`/api/assessments/get-candidate-results?assessmentId=${assessmentId}`)
        if (resultsResponse.data?.success) {
          const candidatesData = resultsResponse.data.data || []
          setCandidates(candidatesData)
          
          // If candidate query param is set, load that candidate's analytics
          if (candidateEmail && typeof candidateEmail === 'string') {
            const candidate = candidatesData.find((c: Candidate) => c.email === candidateEmail)
            if (candidate) {
              setSelectedCandidate(candidateEmail)
              fetchAnalytics(candidate.email, candidate.name)
              fetchProctorLogs(candidate.email)
            }
          }
        }
      } catch (error) {
        console.error('Error fetching data:', error)
        alert('Failed to load data')
        hasFetchedRef.current = null // Reset on error to allow retry
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [assessmentId, candidateEmail])

  const handleCandidateSelect = (email: string, name: string) => {
    setSelectedCandidate(email)
    fetchAnalytics(email, name)
    fetchProctorLogs(email)
    setShowProctorLogs(false)
  }

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'N/A'
    const date = new Date(dateString)
    const options: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    }
    return date.toLocaleString('en-US', options)
  }

  if (loading) {
    return (
      <div className="container">
        <div className="card">
          <div className="text-center">Loading...</div>
        </div>
      </div>
    )
  }

  const selectedCandidateData = candidates.find(c => c.email === selectedCandidate)

  // Calculate overall statistics
  const submittedCandidates = candidates.filter(c => c.submittedAt)
  const totalCandidates = candidates.length
  const submittedCount = submittedCandidates.length
  
  const avgScore = submittedCount > 0 
    ? submittedCandidates.reduce((sum, c) => sum + (c.aiScore !== undefined ? c.aiScore : c.score), 0) / submittedCount 
    : 0
  const avgPercentage = submittedCount > 0
    ? submittedCandidates.reduce((sum, c) => sum + (c.percentageScored !== undefined ? c.percentageScored : (c.maxScore > 0 ? (c.score / c.maxScore) * 100 : 0)), 0) / submittedCount
    : 0
  const passedCount = submittedCandidates.filter(c => c.passed === true).length
  const failedCount = submittedCandidates.filter(c => c.passed === false).length
  const totalMaxScore = submittedCandidates.length > 0 ? submittedCandidates[0].maxScore : 0
  const totalScore = submittedCandidates.reduce((sum, c) => sum + (c.aiScore !== undefined ? c.aiScore : c.score), 0)
  const avgAttempted = submittedCount > 0
    ? submittedCandidates.reduce((sum, c) => sum + c.attempted, 0) / submittedCount
    : 0
  const totalQuestions = assessment?.questions?.length || 0

  return (
    <div className="container">
      <div className="card">
        {/* Back Button */}
        <div style={{ marginBottom: "1.5rem" }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => router.push('/dashboard')}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              padding: "0.5rem 1rem",
              fontSize: "0.875rem",
            }}
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Dashboard
          </button>
        </div>

        <div style={{ marginBottom: "2rem" }}>
          <h1 style={{ fontSize: "2rem", fontWeight: 700, marginBottom: "0.5rem" }}>
            Assessment Analytics
          </h1>
          <p style={{ color: "#64748b", margin: 0 }}>
            {assessment?.assessment?.title || 'Assessment'} - View detailed analytics and AI feedback
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "1.5rem" }}>
          {/* Candidate List */}
          <div>
            <div style={{
              border: "1px solid #e2e8f0",
              borderRadius: "0.75rem",
              padding: "1rem",
              backgroundColor: "#ffffff",
            }}>
              <h2 style={{ fontSize: "1.125rem", fontWeight: 600, marginBottom: "1rem" }}>Candidates</h2>
              <button
                onClick={() => {
                  setSelectedCandidate(null)
                  setAnswerLogs([])
                  setProctorLogs([])
                }}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "0.75rem",
                  borderRadius: "0.5rem",
                  border: selectedCandidate === null
                    ? "2px solid #3b82f6"
                    : "1px solid #e2e8f0",
                  backgroundColor: selectedCandidate === null
                    ? "#eff6ff"
                    : "#ffffff",
                  cursor: "pointer",
                  transition: "all 0.2s",
                  marginBottom: "0.5rem",
                  fontWeight: 600,
                  fontSize: "0.875rem",
                }}
                onMouseEnter={(e) => {
                  if (selectedCandidate !== null) {
                    e.currentTarget.style.backgroundColor = "#f8fafc"
                  }
                }}
                onMouseLeave={(e) => {
                  if (selectedCandidate !== null) {
                    e.currentTarget.style.backgroundColor = "#ffffff"
                  }
                }}
              >
                📊 Overall Analytics
              </button>
              {candidates.length === 0 ? (
                <p style={{ fontSize: "0.875rem", color: "#64748b" }}>
                  No candidates found
                </p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {candidates.map((candidate) => (
                    <button
                      key={candidate.email}
                      onClick={() => handleCandidateSelect(candidate.email, candidate.name)}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        padding: "0.75rem",
                        borderRadius: "0.5rem",
                        border: selectedCandidate === candidate.email
                          ? "2px solid #3b82f6"
                          : "1px solid #e2e8f0",
                        backgroundColor: selectedCandidate === candidate.email
                          ? "#eff6ff"
                          : "#ffffff",
                        cursor: "pointer",
                        transition: "all 0.2s",
                      }}
                      onMouseEnter={(e) => {
                        if (selectedCandidate !== candidate.email) {
                          e.currentTarget.style.backgroundColor = "#f8fafc"
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (selectedCandidate !== candidate.email) {
                          e.currentTarget.style.backgroundColor = "#ffffff"
                        }
                      }}
                    >
                      <div style={{ fontWeight: 600, fontSize: "0.875rem" }}>{candidate.name}</div>
                      <div style={{ fontSize: "0.75rem", color: "#64748b", marginTop: "0.25rem" }}>
                        {candidate.email}
                      </div>
                      {candidate.submittedAt && (
                        <div style={{ fontSize: "0.75rem", color: "#10b981", marginTop: "0.25rem", fontWeight: 600 }}>
                          Score: {candidate.aiScore !== undefined ? candidate.aiScore : candidate.score} / {candidate.maxScore}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Analytics Content */}
          <div>
            {loadingAnalytics ? (
              <div style={{
                border: "1px solid #e2e8f0",
                borderRadius: "0.75rem",
                padding: "3rem",
                textAlign: "center",
                backgroundColor: "#ffffff",
              }}>
                <div>Loading analytics...</div>
              </div>
            ) : !selectedCandidate ? (
              // Overall Analytics View
              <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
                {/* Overall Summary */}
                <div style={{
                  border: "1px solid #e2e8f0",
                  borderRadius: "0.75rem",
                  padding: "1.5rem",
                  backgroundColor: "#ffffff",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                    <h2 style={{ fontSize: "1.25rem", fontWeight: 600, margin: 0 }}>
                      Overall Assessment Performance
                    </h2>
                    {assessmentId && typeof assessmentId === 'string' && candidates.length > 0 && (
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={async () => {
                          // Check for active sessions ONLY when button is clicked
                          const hasActive = await checkActiveSessionsOnClick()
                          if (hasActive) {
                            setShowLiveProctor(true)
                          } else {
                            alert("No active candidates are currently taking the test. The live proctoring dashboard will be available when candidates start their assessment.")
                          }
                        }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "0.5rem",
                          padding: "0.75rem 1.5rem",
                          fontSize: "0.875rem",
                          marginTop: 0,
                        }}
                        title="View live proctoring for active candidates"
                      >
                        <Video style={{ width: "16px", height: "16px" }} />
                        Live Proctoring
                      </button>
                    )}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1rem", marginBottom: "1rem" }}>
                    <div>
                      <div style={{ fontSize: "0.875rem", color: "#64748b", marginBottom: "0.25rem" }}>Total Candidates</div>
                      <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{totalCandidates}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: "0.875rem", color: "#64748b", marginBottom: "0.25rem" }}>Submitted</div>
                      <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>
                        {submittedCount} / {totalCandidates}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: "0.875rem", color: "#64748b", marginBottom: "0.25rem" }}>Average Score</div>
                      <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>
                        {avgScore.toFixed(1)} / {totalMaxScore}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: "0.875rem", color: "#64748b", marginBottom: "0.25rem" }}>Average %</div>
                      <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>
                        {avgPercentage.toFixed(1)}%
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem", marginTop: "1rem" }}>
                    <div style={{
                      padding: "1rem",
                      backgroundColor: "#d1fae5",
                      borderRadius: "0.5rem",
                      border: "1px solid #10b981",
                    }}>
                      <div style={{ fontSize: "0.875rem", color: "#065f46", marginBottom: "0.25rem", fontWeight: 600 }}>Passed</div>
                      <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "#059669" }}>{passedCount}</div>
                    </div>
                    <div style={{
                      padding: "1rem",
                      backgroundColor: "#fee2e2",
                      borderRadius: "0.5rem",
                      border: "1px solid #ef4444",
                    }}>
                      <div style={{ fontSize: "0.875rem", color: "#991b1b", marginBottom: "0.25rem", fontWeight: 600 }}>Failed</div>
                      <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "#dc2626" }}>{failedCount}</div>
                    </div>
                    <div style={{
                      padding: "1rem",
                      backgroundColor: "#fef3c7",
                      borderRadius: "0.5rem",
                      border: "1px solid #f59e0b",
                    }}>
                      <div style={{ fontSize: "0.875rem", color: "#92400e", marginBottom: "0.25rem", fontWeight: 600 }}>In Progress</div>
                      <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "#d97706" }}>{totalCandidates - submittedCount}</div>
                    </div>
                  </div>
                  <div style={{ marginTop: "1rem", padding: "1rem", backgroundColor: "#f8fafc", borderRadius: "0.5rem" }}>
                    <div style={{ fontSize: "0.875rem", color: "#64748b", marginBottom: "0.5rem" }}>Additional Statistics</div>
                    <div style={{ display: "flex", gap: "2rem", fontSize: "0.875rem" }}>
                      <div>
                        <span style={{ fontWeight: 600, color: "#1e293b" }}>Total Questions: </span>
                        <span>{totalQuestions}</span>
                      </div>
                      <div>
                        <span style={{ fontWeight: 600, color: "#1e293b" }}>Avg Attempted: </span>
                        <span>{avgAttempted.toFixed(1)}</span>
                      </div>
                      <div>
                        <span style={{ fontWeight: 600, color: "#1e293b" }}>Total Score: </span>
                        <span>{totalScore.toFixed(1)} / {(totalMaxScore * submittedCount).toFixed(1)}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Candidate Performance Table */}
                {submittedCandidates.length > 0 && (
                  <div style={{
                    border: "1px solid #e2e8f0",
                    borderRadius: "0.75rem",
                    padding: "1.5rem",
                    backgroundColor: "#ffffff",
                  }}>
                    <h2 style={{ fontSize: "1.125rem", fontWeight: 600, marginBottom: "1rem" }}>
                      Individual Candidate Performance
                    </h2>
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                          <tr style={{ backgroundColor: "#f8fafc", borderBottom: "2px solid #e2e8f0" }}>
                            <th style={{ padding: "0.75rem", textAlign: "left", fontSize: "0.875rem", fontWeight: 600, color: "#1e293b" }}>Name</th>
                            <th style={{ padding: "0.75rem", textAlign: "left", fontSize: "0.875rem", fontWeight: 600, color: "#1e293b" }}>Email</th>
                            <th style={{ padding: "0.75rem", textAlign: "left", fontSize: "0.875rem", fontWeight: 600, color: "#1e293b" }}>Score</th>
                            <th style={{ padding: "0.75rem", textAlign: "left", fontSize: "0.875rem", fontWeight: 600, color: "#1e293b" }}>Percentage</th>
                            <th style={{ padding: "0.75rem", textAlign: "left", fontSize: "0.875rem", fontWeight: 600, color: "#1e293b" }}>Status</th>
                            <th style={{ padding: "0.75rem", textAlign: "left", fontSize: "0.875rem", fontWeight: 600, color: "#1e293b" }}>Attempted</th>
                          </tr>
                        </thead>
                        <tbody>
                          {submittedCandidates.map((candidate, index) => (
                            <tr key={index} style={{ borderBottom: "1px solid #e2e8f0" }}>
                              <td style={{ padding: "0.75rem", fontSize: "0.875rem" }}>{candidate.name}</td>
                              <td style={{ padding: "0.75rem", fontSize: "0.875rem", color: "#64748b" }}>{candidate.email}</td>
                              <td style={{ padding: "0.75rem", fontSize: "0.875rem", fontWeight: 600 }}>
                                {candidate.aiScore !== undefined ? candidate.aiScore : candidate.score} / {candidate.maxScore}
                              </td>
                              <td style={{ padding: "0.75rem", fontSize: "0.875rem", fontWeight: 600 }}>
                                {candidate.percentageScored !== undefined 
                                  ? candidate.percentageScored.toFixed(1) 
                                  : (candidate.maxScore > 0 ? Math.round((candidate.score / candidate.maxScore) * 100) : 0)}%
                              </td>
                              <td style={{ padding: "0.75rem" }}>
                                {candidate.passed !== undefined ? (
                                  <span style={{
                                    padding: "0.25rem 0.75rem",
                                    borderRadius: "9999px",
                                    fontSize: "0.75rem",
                                    fontWeight: 600,
                                    backgroundColor: candidate.passed ? "#d1fae5" : "#fee2e2",
                                    color: candidate.passed ? "#065f46" : "#991b1b",
                                  }}>
                                    {candidate.passed ? "Pass" : "Fail"}
                                  </span>
                                ) : (
                                  <span style={{ color: "#64748b" }}>N/A</span>
                                )}
                              </td>
                              <td style={{ padding: "0.75rem", fontSize: "0.875rem" }}>
                                <span style={{ color: "#10b981", fontWeight: 600 }}>{candidate.attempted}</span> / {totalQuestions}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            ) : !selectedCandidateData ? (
              <div style={{
                border: "1px solid #e2e8f0",
                borderRadius: "0.75rem",
                padding: "3rem",
                textAlign: "center",
                backgroundColor: "#ffffff",
              }}>
                <p style={{ color: "#64748b" }}>
                  Candidate not found
                </p>
              </div>
            ) : !selectedCandidateData.submittedAt ? (
              <div style={{
                border: "1px solid #e2e8f0",
                borderRadius: "0.75rem",
                padding: "3rem",
                textAlign: "center",
                backgroundColor: "#ffffff",
              }}>
                <p style={{ color: "#64748b" }}>
                  {selectedCandidateData.name} has not submitted the assessment yet.
                </p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
                {/* Overall Summary */}
                <div style={{
                  border: "1px solid #e2e8f0",
                  borderRadius: "0.75rem",
                  padding: "1.5rem",
                  backgroundColor: "#ffffff",
                }}>
                  <h2 style={{ fontSize: "1.25rem", fontWeight: 600, marginBottom: "1rem" }}>
                    {selectedCandidateData.name} - Overall Performance
                  </h2>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem", marginBottom: "1rem" }}>
                    <div>
                      <div style={{ fontSize: "0.875rem", color: "#64748b" }}>Total Score</div>
                      <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>
                        {selectedCandidateData.aiScore !== undefined ? selectedCandidateData.aiScore : selectedCandidateData.score} / {selectedCandidateData.maxScore}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: "0.875rem", color: "#64748b" }}>Percentage</div>
                      <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>
                        {selectedCandidateData.percentageScored !== undefined 
                          ? selectedCandidateData.percentageScored.toFixed(1) 
                          : (selectedCandidateData.maxScore > 0 
                            ? Math.round((selectedCandidateData.score / selectedCandidateData.maxScore) * 100) 
                            : 0)}%
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: "0.875rem", color: "#64748b" }}>Status</div>
                      <div>
                        {selectedCandidateData.passed !== undefined ? (
                          <span style={{
                            padding: "0.25rem 0.75rem",
                            borderRadius: "9999px",
                            fontSize: "0.875rem",
                            fontWeight: 600,
                            backgroundColor: selectedCandidateData.passed ? "#d1fae5" : "#fee2e2",
                            color: selectedCandidateData.passed ? "#065f46" : "#991b1b",
                          }}>
                            {selectedCandidateData.passed ? "Pass" : "Fail"}
                          </span>
                        ) : (
                          <span style={{ color: "#64748b" }}>N/A</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "1rem", fontSize: "0.875rem", color: "#64748b" }}>
                    <div>
                      <span style={{ fontWeight: 600, color: "#1e293b" }}>Attempted: </span>
                      <span style={{ color: "#10b981", fontWeight: 600 }}>{selectedCandidateData.attempted}</span>
                    </div>
                    <div>
                      <span style={{ fontWeight: 600, color: "#1e293b" }}>Not Attempted: </span>
                      <span style={{ color: "#ef4444", fontWeight: 600 }}>{selectedCandidateData.notAttempted}</span>
                    </div>
                    <div>
                      <span style={{ fontWeight: 600, color: "#1e293b" }}>Submitted: </span>
                      {formatDate(selectedCandidateData.submittedAt)}
                    </div>
                  </div>
                </div>

                {/* Proctoring Logs Section */}
                <div style={{
                  border: "1px solid #e2e8f0",
                  borderRadius: "0.75rem",
                  padding: "1.5rem",
                  backgroundColor: "#ffffff",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <AlertTriangle style={{ width: "20px", height: "20px", color: "#f59e0b" }} />
                      <h2 style={{ fontSize: "1.125rem", fontWeight: 600 }}>Proctoring Logs</h2>
                      {proctorLogs.length > 0 && (
                        <span style={{
                          padding: "0.25rem 0.5rem",
                          fontSize: "0.75rem",
                          fontWeight: 600,
                          backgroundColor: "#fee2e2",
                          color: "#dc2626",
                          borderRadius: "9999px",
                        }}>
                          {proctorLogs.length} {proctorLogs.length === 1 ? 'violation' : 'violations'}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setShowProctorLogs(!showProctorLogs)}
                      disabled={loadingProctorLogs}
                      style={{ padding: "0.5rem 1rem", fontSize: "0.875rem" }}
                    >
                      {loadingProctorLogs ? 'Loading...' : showProctorLogs ? 'Hide Logs' : 'Show Logs'}
                    </button>
                  </div>

                  {loadingProctorLogs ? (
                    <div style={{ textAlign: "center", padding: "2rem", color: "#64748b" }}>
                      Loading proctoring logs...
                    </div>
                  ) : proctorLogs.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "2rem", color: "#64748b" }}>
                      No proctoring violations detected
                    </div>
                  ) : showProctorLogs ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", maxHeight: "400px", overflowY: "auto" }}>
                      {proctorLogs.map((log, index) => (
                        <div
                          key={log._id || index}
                          style={{
                            border: "1px solid #fecaca",
                            borderRadius: "0.5rem",
                            padding: "1rem",
                            backgroundColor: "#fef2f2",
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: "0.5rem" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                              <AlertTriangle style={{ width: "16px", height: "16px", color: "#dc2626" }} />
                              <span style={{ fontWeight: 600, color: "#dc2626", fontSize: "0.875rem" }}>
                                {eventTypeLabels[log.eventType] || log.eventType || 'Unknown Violation'}
                              </span>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.75rem", color: "#64748b" }}>
                              <Clock style={{ width: "12px", height: "12px" }} />
                              <span>{formatDate(log.timestamp)}</span>
                            </div>
                          </div>
                          
                          {log.metadata && Object.keys(log.metadata).length > 0 && (
                            <div style={{ marginTop: "0.5rem", fontSize: "0.875rem" }}>
                              <div style={{ fontSize: "0.75rem", color: "#64748b", marginBottom: "0.25rem" }}>Details:</div>
                              <div style={{ backgroundColor: "#f8fafc", borderRadius: "0.375rem", padding: "0.5rem", fontFamily: "monospace", fontSize: "0.75rem" }}>
                                {Object.entries(log.metadata).map(([key, value]) => (
                                  <div key={key} style={{ marginBottom: "0.25rem" }}>
                                    <span style={{ color: "#64748b" }}>{key}:</span>{' '}
                                    <span style={{ color: "#1e293b" }}>
                                      {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {log.snapshotBase64 && (
                            <div style={{ marginTop: "0.75rem" }}>
                              <div style={{ fontSize: "0.75rem", color: "#64748b", marginBottom: "0.5rem" }}>Evidence Snapshot:</div>
                              <img
                                src={log.snapshotBase64.startsWith("data:") ? log.snapshotBase64 : `data:image/png;base64,${log.snapshotBase64}`}
                                alt="Violation snapshot"
                                style={{ maxWidth: "100%", height: "auto", borderRadius: "0.375rem", border: "1px solid #e2e8f0", maxHeight: "200px" }}
                                onError={(e) => {
                                  console.error("Error loading snapshot image:", e);
                                  (e.target as HTMLImageElement).style.display = "none";
                                }}
                              />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>

                {/* Question Analytics */}
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
                    <h3 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>
                      Question {questionLog.questionIndex + 1}: {questionLog.questionType}
                    </h3>
                    <p style={{ color: "#1e293b", lineHeight: 1.6, marginBottom: "1rem", fontSize: "0.875rem" }}>
                      {questionLog.questionText}
                    </p>
                    
                    {/* MCQ Options Display */}
                    {questionLog.questionType === "MCQ" && questionLog.options && questionLog.options.length > 0 && (
                      <div style={{ marginBottom: "1rem" }}>
                        <h4 style={{ margin: 0, marginBottom: "0.5rem", fontSize: "0.875rem", color: "#64748b", fontWeight: 600 }}>
                          Options:
                        </h4>
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                          {questionLog.options.map((option, optIndex) => {
                            const optionLetter = String.fromCharCode(65 + optIndex);
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
                                <span style={{
                                  fontWeight: 700,
                                  color: showAsCorrect ? "#059669" : showAsWrong ? "#dc2626" : "#64748b",
                                  fontSize: "0.875rem",
                                  minWidth: "24px",
                                }}>
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
                          <div style={{
                            marginTop: "0.75rem",
                            padding: "0.75rem",
                            backgroundColor: questionLog.isMcqCorrect ? "#f0fdf4" : "#fef2f2",
                            border: `1px solid ${questionLog.isMcqCorrect ? "#10b981" : "#ef4444"}`,
                            borderRadius: "0.5rem"
                          }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <span style={{
                                fontWeight: 600,
                                color: questionLog.isMcqCorrect ? "#065f46" : "#991b1b",
                                fontSize: "0.875rem"
                              }}>
                                Answer Status:
                              </span>
                              <span style={{
                                fontWeight: 700,
                                color: questionLog.isMcqCorrect ? "#059669" : "#dc2626",
                                fontSize: "1rem"
                              }}>
                                {questionLog.isMcqCorrect ? "✓ Correct" : "✗ Incorrect"}
                              </span>
                            </div>
                            {questionLog.aiScore !== undefined && (
                              <p style={{
                                marginTop: "0.5rem",
                                marginBottom: 0,
                                fontSize: "0.875rem",
                                color: questionLog.isMcqCorrect ? "#047857" : "#991b1b",
                                fontWeight: 600
                              }}>
                                Score: {questionLog.aiScore} / {questionLog.maxScore || 5} points
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                    
                    {/* AI Score for non-MCQ questions */}
                    {questionLog.questionType !== "MCQ" && questionLog.aiScore !== undefined && (
                      <div style={{
                        marginTop: "0.75rem",
                        padding: "0.75rem",
                        backgroundColor: "#f0fdf4",
                        border: "1px solid #10b981",
                        borderRadius: "0.5rem"
                      }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontWeight: 600, color: "#065f46", fontSize: "0.875rem" }}>
                            AI Evaluated Score:
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

                    {/* Answer Versions */}
                    <div style={{ marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid #e2e8f0" }}>
                      <h4 style={{ margin: 0, marginBottom: "0.75rem", fontSize: "0.875rem", color: "#1e293b", fontWeight: 600 }}>
                        Answer Versions:
                      </h4>
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                        {questionLog.logs.map((log, logIndex) => (
                          <div
                            key={logIndex}
                            style={{
                              padding: "0.75rem",
                              backgroundColor: "#f8fafc",
                              border: "1px solid #e2e8f0",
                              borderRadius: "0.5rem",
                            }}
                          >
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: "0.5rem" }}>
                              <span style={{
                                backgroundColor: "#dbeafe",
                                color: "#1e40af",
                                padding: "0.25rem 0.75rem",
                                borderRadius: "9999px",
                                fontSize: "0.75rem",
                                fontWeight: 600,
                              }}>
                                Version {log.version}
                              </span>
                              <span style={{ fontSize: "0.75rem", color: "#64748b" }}>
                                {formatDate(log.timestamp)}
                              </span>
                            </div>
                            <p style={{
                              color: "#1e293b",
                              lineHeight: 1.6,
                              whiteSpace: "pre-wrap",
                              margin: 0,
                              fontSize: "0.875rem",
                            }}>
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
        </div>
      </div>

      {/* Multi Live Proctoring Panel */}
      {showLiveProctor && assessmentId && typeof assessmentId === 'string' && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.95)",
            zIndex: 9999,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: "1rem 1.5rem",
              backgroundColor: "#1e293b",
              borderBottom: "1px solid #334155",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
              <Video style={{ width: "24px", height: "24px", color: "#10b981" }} />
              <div>
                <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700, color: "#ffffff" }}>
                  Live Proctoring Dashboard
                </h2>
                <p style={{ margin: "0.25rem 0 0", fontSize: "0.875rem", color: "#94a3b8" }}>
                  Monitoring {candidateStreams.length} active candidate{candidateStreams.length !== 1 ? 's' : ''}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                console.log('[Live Proctor] Close button clicked, stopping monitoring...')
                isMonitoringRef.current = false
                stopMonitoring()
                setShowLiveProctor(false)
              }}
              style={{
                padding: "0.75rem 1.5rem",
                backgroundColor: "#ef4444",
                color: "#ffffff",
                border: "none",
                borderRadius: "0.5rem",
                fontSize: "0.875rem",
                fontWeight: 600,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
              }}
            >
              <span>✕</span>
              Close
            </button>
          </div>
          
          {/* Multi-Proctor Grid */}
          <div style={{ flex: 1, overflow: "hidden" }}>
            <MultiProctorGrid
              candidateStreams={candidateStreams}
              onRefreshCandidate={refreshCandidate}
              isLoading={isProctorLoading}
            />
          </div>
        </div>
      )}
    </div>
  )
}

// Server-side authentication check
export const getServerSideProps: GetServerSideProps = requireAuth;

