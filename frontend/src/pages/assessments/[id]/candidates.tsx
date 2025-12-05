'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { GetServerSideProps } from 'next'
import { requireAuth } from '../../../lib/auth'
import Link from 'next/link'
import axios from 'axios'
import { ArrowLeft, Mail, CheckCircle, Clock, BarChart3 } from 'lucide-react'

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

export default function CandidatesPage() {
  const router = useRouter()
  const { id: assessmentId } = router.query
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [loading, setLoading] = useState(true)
  const [assessment, setAssessment] = useState<any>(null)

  useEffect(() => {
    if (!assessmentId || typeof assessmentId !== 'string') return

    const fetchData = async () => {
      try {
        setLoading(true)
        
        // Fetch assessment details
        const assessmentResponse = await axios.get(`/api/assessments/get-questions?assessmentId=${assessmentId}`)
        if (assessmentResponse.data?.success && assessmentResponse.data?.data) {
          setAssessment(assessmentResponse.data.data)
        }
        
        // Fetch candidate results
        const resultsResponse = await axios.get(`/api/assessments/get-candidate-results?assessmentId=${assessmentId}`)
        if (resultsResponse.data?.success) {
          setCandidates(resultsResponse.data.data || [])
        }
      } catch (error) {
        console.error('Error fetching data:', error)
        alert('Failed to load candidates')
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [assessmentId])

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

  return (
    <div className="container">
      <div className="card">
        {/* Back Button */}
        <div style={{ marginBottom: "1.5rem" }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => router.push(`/assessments/${assessmentId}`)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              padding: "0.5rem 1rem",
              fontSize: "0.875rem",
            }}
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Assessment
          </button>
        </div>

        <div style={{ marginBottom: "2rem", display: "flex", justifyContent: "space-between", alignItems: "start" }}>
          <div>
            <h1 style={{ fontSize: "2rem", fontWeight: 700, marginBottom: "0.5rem" }}>
              Candidates
            </h1>
            <p style={{ color: "#64748b", margin: 0 }}>
              {assessment?.assessment?.title || 'Assessment'} - View all candidates
            </p>
          </div>
          <Link href={`/assessments/${assessmentId}/analytics`}>
            <button
              type="button"
              className="btn-primary"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                padding: "0.75rem 1.5rem",
                fontSize: "0.875rem",
                marginTop: 0,
              }}
            >
              <BarChart3 style={{ width: "16px", height: "16px" }} />
              Analytics
            </button>
          </Link>
        </div>

        {candidates.length === 0 ? (
          <div style={{ textAlign: "center", padding: "3rem", color: "#64748b" }}>
            <p>No candidates have taken this assessment yet.</p>
            <p style={{ marginTop: "0.5rem", fontSize: "0.875rem" }}>
              Candidates will appear here once they access the assessment link and start taking it.
            </p>
          </div>
        ) : (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
              <p style={{ fontSize: "0.875rem", color: "#64748b", margin: 0 }}>
                Total: {candidates.length} candidates
              </p>
              <p style={{ fontSize: "0.875rem", color: "#64748b", margin: 0 }}>
                Submitted: {candidates.filter(c => c.submittedAt).length} / {candidates.length}
              </p>
            </div>
            
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              {candidates.map((candidate, index) => (
                <div
                  key={index}
                  style={{
                    border: "1px solid #e2e8f0",
                    borderRadius: "0.75rem",
                    padding: "1.5rem",
                    backgroundColor: "#ffffff",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.5rem" }}>
                        <h3 style={{ margin: 0, fontSize: "1.125rem", fontWeight: 600 }}>
                          {candidate.name}
                        </h3>
                        {candidate.submittedAt ? (
                          <span style={{
                            padding: "0.25rem 0.75rem",
                            borderRadius: "9999px",
                            fontSize: "0.75rem",
                            fontWeight: 600,
                            backgroundColor: "#d1fae5",
                            color: "#065f46",
                            display: "flex",
                            alignItems: "center",
                            gap: "0.25rem",
                          }}>
                            <CheckCircle style={{ width: "12px", height: "12px" }} />
                            Submitted
                          </span>
                        ) : (
                          <span style={{
                            padding: "0.25rem 0.75rem",
                            borderRadius: "9999px",
                            fontSize: "0.75rem",
                            fontWeight: 600,
                            backgroundColor: "#fef3c7",
                            color: "#92400e",
                            display: "flex",
                            alignItems: "center",
                            gap: "0.25rem",
                          }}>
                            <Clock style={{ width: "12px", height: "12px" }} />
                            In Progress
                          </span>
                        )}
                      </div>
                      
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem", color: "#64748b", fontSize: "0.875rem" }}>
                        <Mail style={{ width: "16px", height: "16px" }} />
                        {candidate.email}
                      </div>
                      
                      {candidate.submittedAt && (
                        <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", fontSize: "0.875rem", color: "#64748b" }}>
                          <div>
                            <span style={{ fontWeight: 600, color: "#1e293b" }}>Score: </span>
                            {candidate.aiScore !== undefined ? candidate.aiScore : candidate.score} / {candidate.maxScore}
                            {candidate.percentageScored !== undefined && (
                              <span style={{ marginLeft: "0.5rem", color: candidate.passed ? "#059669" : "#dc2626", fontWeight: 600 }}>
                                ({candidate.percentageScored.toFixed(1)}%)
                              </span>
                            )}
                          </div>
                          <div>
                            <span style={{ fontWeight: 600, color: "#1e293b" }}>Attempted: </span>
                            <span style={{ color: "#10b981", fontWeight: 600 }}>{candidate.attempted}</span>
                          </div>
                          <div>
                            <span style={{ fontWeight: 600, color: "#1e293b" }}>Not Attempted: </span>
                            <span style={{ color: "#ef4444", fontWeight: 600 }}>{candidate.notAttempted}</span>
                          </div>
                          {candidate.passed !== undefined && (
                            <div>
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
                            </div>
                          )}
                          <div>
                            <span style={{ fontWeight: 600, color: "#1e293b" }}>Submitted: </span>
                            {formatDate(candidate.submittedAt)}
                          </div>
                        </div>
                      )}
                    </div>
                    
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      {candidate.submittedAt && (
                        <>
                          <Link href={`/assessments/${assessmentId}/analytics?candidate=${encodeURIComponent(candidate.email)}`}>
                            <button
                              type="button"
                              className="btn-secondary"
                              style={{ 
                                padding: "0.5rem 1rem", 
                                fontSize: "0.875rem",
                                whiteSpace: "nowrap"
                              }}
                            >
                              View Analytics
                            </button>
                          </Link>
                          <Link href={`/admin/assessment/${assessmentId}/candidate/${encodeURIComponent(candidate.email)}`}>
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
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// Server-side authentication check
export const getServerSideProps: GetServerSideProps = requireAuth;

