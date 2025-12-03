'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { Card, CardContent } from '../../../../components/dsa/ui/card'
import { Button } from '../../../../components/dsa/ui/button'
import dsaApi from '../../../../lib/dsa/api'
import { ArrowLeft, Lightbulb, CheckCircle2, TrendingUp, AlertTriangle, Eye, Clock } from 'lucide-react'

interface AIFeedback {
  overall_score?: number
  feedback_summary?: string
  one_liner?: string
  code_quality?: {
    score?: number
    comments?: string
  }
  efficiency?: {
    time_complexity?: string
    space_complexity?: string
    comments?: string
  }
  correctness?: {
    score?: number
    comments?: string
  }
  suggestions?: string[]
  strengths?: string[]
  areas_for_improvement?: string[]
  deduction_reasons?: string[]
  improvement_suggestions?: string[]
  test_breakdown?: {
    public_passed?: number
    public_total?: number
    hidden_passed?: number
    hidden_total?: number
    total_passed?: number
    total_tests?: number
  }
  scoring_basis?: {
    base_score?: number
    correctness_score?: number
    pass_rate?: string
    efficiency_bonus?: number
    code_quality_score?: number
    code_quality_adjustment?: number
    time_complexity?: string
    space_complexity?: string
    final_score?: number
    points_deducted?: number
    explanation?: string
  }
}

interface QuestionAnalytics {
  question_id: string
  question_title: string
  language: string
  status: string
  passed_testcases: number
  total_testcases: number
  execution_time?: number
  memory_used?: number
  code: string
  test_results: any[]
  ai_feedback?: AIFeedback
  created_at: string | null
}

interface CandidateAnalytics {
  candidate: {
    name: string
    email: string
  }
  submission: {
    score: number
    started_at: string | null
    submitted_at: string | null
    is_completed: boolean
  } | null
  question_analytics: QuestionAnalytics[]
  activity_logs: any[]
}

export default function AnalyticsPage() {
  const router = useRouter()
  const { id: testId, candidate: candidateUserId } = router.query
  const [candidates, setCandidates] = useState<any[]>([])
  const [selectedCandidate, setSelectedCandidate] = useState<string | null>(null)
  const [analytics, setAnalytics] = useState<CandidateAnalytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingAnalytics, setLoadingAnalytics] = useState(false)
  const [proctorLogs, setProctorLogs] = useState<any[]>([])
  const [eventTypeLabels, setEventTypeLabels] = useState<Record<string, string>>({})
  const [loadingProctorLogs, setLoadingProctorLogs] = useState(false)
  const [showProctorLogs, setShowProctorLogs] = useState(false)

  const fetchAnalytics = async (userId: string) => {
    if (!testId || typeof testId !== 'string') return
    
    setLoadingAnalytics(true)
    try {
      const response = await dsaApi.get(`/tests/${testId}/candidates/${userId}/analytics`)
      setAnalytics(response.data)
    } catch (error) {
      console.error('Error fetching analytics:', error)
      alert('Failed to load analytics')
    } finally {
      setLoadingAnalytics(false)
    }
  }

  const fetchProctorLogs = async (userId: string) => {
    if (!testId || typeof testId !== 'string') return
    
    setLoadingProctorLogs(true)
    try {
      // Use testId as assessmentId (as per how proctor events are recorded)
      const response = await fetch(`/api/proctor/logs?assessmentId=${encodeURIComponent(testId)}&userId=${encodeURIComponent(userId)}`)
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

  useEffect(() => {
    if (!testId || typeof testId !== 'string') return

    const fetchCandidates = async () => {
      try {
        const response = await dsaApi.get(`/tests/${testId}/candidates`)
        setCandidates(response.data)
        
        // If candidate query param is set, load that candidate's analytics
        if (candidateUserId && typeof candidateUserId === 'string') {
          setSelectedCandidate(candidateUserId)
          fetchAnalytics(candidateUserId)
          fetchProctorLogs(candidateUserId)
        }
      } catch (error) {
        console.error('Error fetching candidates:', error)
        alert('Failed to load candidates')
      } finally {
        setLoading(false)
      }
    }

    fetchCandidates()
  }, [testId, candidateUserId])

  const handleCandidateSelect = (userId: string) => {
    setSelectedCandidate(userId)
    fetchAnalytics(userId)
    fetchProctorLogs(userId)
    setShowProctorLogs(false) // Reset proctor logs visibility
  }

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'N/A'
    const date = new Date(dateString)
    // Format: M/D/YYYY, H:MM:SS AM/PM (local time)
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
      <div className="min-h-screen bg-background">
        <div className="container mx-auto px-4 py-8">
          <div className="text-center">Loading...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8">
        {/* Back Button */}
        <div style={{ marginBottom: "1.5rem" }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => router.push("/dsa/tests")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              padding: "0.5rem 1rem",
              fontSize: "0.875rem",
            }}
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Test Management
          </button>
        </div>

        <div className="mb-6">
          <h1 className="text-4xl font-bold">Test Analytics</h1>
          <p className="text-muted-foreground mt-1">
            View detailed analytics and AI feedback for candidates
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Candidate List */}
          <div className="lg:col-span-1">
            <Card>
              <CardContent className="p-4">
                <h2 className="font-semibold text-lg mb-4">Candidates</h2>
                {candidates.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No candidates found
                  </p>
                ) : (
                  <div className="space-y-2">
                    {candidates.map((candidate) => (
                      <button
                        key={candidate.user_id}
                        onClick={() => handleCandidateSelect(candidate.user_id)}
                        className={`w-full text-left p-3 rounded-md border transition-colors ${
                          selectedCandidate === candidate.user_id
                            ? 'bg-blue-500/10 border-blue-500'
                            : 'border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <div className="font-medium">{candidate.name}</div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {candidate.email}
                        </div>
                        {candidate.has_submitted && (
                          <div className="text-xs text-green-600 mt-1">
                            Score: {candidate.submission_score}
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Analytics Content */}
          <div className="lg:col-span-2">
            {loadingAnalytics ? (
              <Card>
                <CardContent className="p-8 text-center">
                  <div>Loading analytics...</div>
                </CardContent>
              </Card>
            ) : !selectedCandidate || !analytics ? (
              <Card>
                <CardContent className="p-8 text-center">
                  <p className="text-muted-foreground">
                    Select a candidate to view their analytics
                  </p>
                </CardContent>
              </Card>
            ) : !analytics.submission ? (
              <Card>
                <CardContent className="p-8 text-center">
                  <p className="text-muted-foreground">
                    {analytics.candidate.name} has not submitted the test yet.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-6">
                {/* Overall Summary */}
                <Card>
                  <CardContent className="p-6">
                    <h2 className="font-semibold text-xl mb-4">
                      {analytics.candidate.name} - Overall Performance
                    </h2>
                    <div className="grid grid-cols-3 gap-4 mb-4">
                      <div>
                        <div className="text-sm text-muted-foreground">Total Score</div>
                        <div className="text-2xl font-bold">{analytics.submission.score}</div>
                      </div>
                      <div>
                        <div className="text-sm text-muted-foreground">Started</div>
                        <div className="text-sm">{formatDate(analytics.submission.started_at)}</div>
                      </div>
                      <div>
                        <div className="text-sm text-muted-foreground">Submitted</div>
                        <div className="text-sm">{formatDate(analytics.submission.submitted_at)}</div>
                      </div>
                    </div>

                    {/* Overall Score Deduction Reasons */}
                    {(() => {
                      // Calculate maximum possible score (assuming 100 per question)
                      const maxPossibleScore = analytics.question_analytics.length * 100
                      const actualScore = analytics.submission.score
                      const scoreDifference = maxPossibleScore - actualScore
                      
                      // Aggregate all deduction reasons from questions with score < 100
                      const allDeductionReasons: string[] = []
                      const allImprovementSuggestions: string[] = []
                      
                      analytics.question_analytics.forEach((qa, index) => {
                        if (qa.ai_feedback?.overall_score !== undefined && qa.ai_feedback.overall_score < 100) {
                          const questionDeduction = 100 - qa.ai_feedback.overall_score
                          
                          // Use deduction_reasons if available
                          if (qa.ai_feedback.deduction_reasons && qa.ai_feedback.deduction_reasons.length > 0) {
                            qa.ai_feedback.deduction_reasons.forEach(reason => {
                              allDeductionReasons.push(`Question ${index + 1}: ${reason} (-${questionDeduction} points)`)
                            })
                          } else if (qa.ai_feedback.scoring_basis) {
                            // If no deduction_reasons, use scoring_basis to explain the deduction
                            const basis = qa.ai_feedback.scoring_basis
                            const reasons: string[] = []
                            
                            // Explain base score deduction
                            if (basis.base_score && basis.base_score < 100) {
                              reasons.push(`Base score reduced to ${basis.base_score}/100 due to test pass rate: ${basis.pass_rate || 'N/A'}`)
                            }
                            
                            // Explain efficiency penalty
                            if (basis.efficiency_bonus && basis.efficiency_bonus < 0) {
                              reasons.push(`Efficiency penalty: ${basis.efficiency_bonus} points (Time: ${basis.time_complexity}, Space: ${basis.space_complexity})`)
                            }
                            
                            // Explain code quality penalty
                            if (basis.code_quality_adjustment && basis.code_quality_adjustment < 0) {
                              reasons.push(`Code quality adjustment: ${basis.code_quality_adjustment} points`)
                            }
                            
                            // If we have reasons from scoring_basis, use them
                            if (reasons.length > 0) {
                              reasons.forEach(reason => {
                                allDeductionReasons.push(`Question ${index + 1}: ${reason} (-${questionDeduction} points)`)
                              })
                            } else {
                              // Final fallback: show the calculation
                              const effBonus = basis.efficiency_bonus || 0
                              const codeQualAdj = basis.code_quality_adjustment || 0
                              allDeductionReasons.push(
                                `Question ${index + 1}: Score ${qa.ai_feedback.overall_score}/100 calculated as Base (${basis.base_score || 'N/A'}) + Efficiency (${effBonus >= 0 ? '+' : ''}${effBonus}) + Code Quality (${codeQualAdj >= 0 ? '+' : ''}${codeQualAdj}) = ${qa.ai_feedback.overall_score} (-${questionDeduction} points)`
                              )
                            }
                          } else {
                            // If no deduction_reasons and no scoring_basis, add a generic one
                            allDeductionReasons.push(`Question ${index + 1}: Score ${qa.ai_feedback.overall_score}/100 (-${questionDeduction} points)`)
                          }
                          
                          if (qa.ai_feedback.improvement_suggestions && qa.ai_feedback.improvement_suggestions.length > 0) {
                            qa.ai_feedback.improvement_suggestions.forEach(suggestion => {
                              allImprovementSuggestions.push(`Question ${index + 1}: ${suggestion}`)
                            })
                          }
                        }
                      })

                      if (scoreDifference > 0) {
                        return (
                          <div className="mt-4 space-y-3">
                            <div className="bg-red-50 dark:bg-red-900/30 border-2 border-red-400 dark:border-red-500/50 rounded-lg p-4">
                              <h4 className="text-base font-bold text-red-700 dark:text-red-300 mb-3 flex items-center gap-2">
                                <AlertTriangle className="w-5 h-5" />
                                Overall Score Deduction ({scoreDifference} points deducted)
                              </h4>
                              <div className="text-sm font-semibold text-red-800 dark:text-red-200 mb-3 bg-red-100 dark:bg-red-900/50 px-3 py-2 rounded">
                                Total Score: {actualScore}/{maxPossibleScore}
                              </div>
                              {allDeductionReasons.length > 0 ? (
                                <ul className="text-sm text-red-900 dark:text-red-100 space-y-2 list-disc list-inside font-medium">
                                  {allDeductionReasons.map((reason, idx) => (
                                    <li key={idx} className="leading-relaxed">{reason}</li>
                                  ))}
                                </ul>
                              ) : (
                                <div className="text-sm text-red-900 dark:text-red-100">
                                  <p className="font-medium mb-2">Score breakdown by question:</p>
                                  <ul className="list-disc list-inside space-y-1">
                                    {analytics.question_analytics.map((qa, idx) => {
                                      if (qa.ai_feedback?.overall_score !== undefined && qa.ai_feedback.overall_score < 100) {
                                        const deduction = 100 - qa.ai_feedback.overall_score
                                        return (
                                          <li key={idx}>
                                            Question {idx + 1}: {qa.ai_feedback.overall_score}/100 (-{deduction} points)
                                            {qa.ai_feedback.scoring_basis && (() => {
                                              const effBonus = qa.ai_feedback.scoring_basis.efficiency_bonus || 0
                                              const codeQualAdj = qa.ai_feedback.scoring_basis.code_quality_adjustment || 0
                                              return (
                                                <span className="text-xs block ml-4 mt-1 text-red-700 dark:text-red-300">
                                                  Base: {qa.ai_feedback.scoring_basis.base_score}, 
                                                  Efficiency: {effBonus >= 0 ? '+' : ''}{effBonus}, 
                                                  Code Quality: {codeQualAdj >= 0 ? '+' : ''}{codeQualAdj}
                                                </span>
                                              )
                                            })()}
                                          </li>
                                        )
                                      }
                                      return null
                                    })}
                                  </ul>
                                </div>
                              )}
                            </div>

                            {allImprovementSuggestions.length > 0 && (
                              <div className="bg-yellow-50 dark:bg-yellow-900/30 border-2 border-yellow-400 dark:border-yellow-500/50 rounded-lg p-4">
                                <h4 className="text-base font-bold text-yellow-700 dark:text-yellow-300 mb-3 flex items-center gap-2">
                                  <Lightbulb className="w-5 h-5" />
                                  Overall Improvement Suggestions
                                </h4>
                                <ul className="text-sm text-yellow-900 dark:text-yellow-100 space-y-2 list-disc list-inside font-medium">
                                  {allImprovementSuggestions.map((suggestion, idx) => (
                                    <li key={idx} className="leading-relaxed">{suggestion}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        )
                      }
                      return null
                    })()}
                  </CardContent>
                </Card>

                {/* Proctoring Logs Section */}
                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <AlertTriangle className="w-5 h-5 text-orange-500" />
                        <h2 className="font-semibold text-xl">Proctoring Logs</h2>
                        {proctorLogs.length > 0 && (
                          <span className="px-2 py-1 text-xs font-semibold bg-red-500/20 text-red-400 rounded-full">
                            {proctorLogs.length} {proctorLogs.length === 1 ? 'violation' : 'violations'}
                          </span>
                        )}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowProctorLogs(!showProctorLogs)}
                        disabled={loadingProctorLogs}
                      >
                        {loadingProctorLogs ? 'Loading...' : showProctorLogs ? 'Hide Logs' : 'Show Logs'}
                      </Button>
                    </div>

                    {loadingProctorLogs ? (
                      <div className="text-center py-4 text-muted-foreground">
                        Loading proctoring logs...
                      </div>
                    ) : proctorLogs.length === 0 ? (
                      <div className="text-center py-4 text-muted-foreground">
                        No proctoring violations detected
                      </div>
                    ) : showProctorLogs ? (
                      <div className="space-y-3 max-h-[600px] overflow-y-auto">
                        {proctorLogs.map((log, index) => (
                          <div
                            key={log._id || index}
                            className="border border-red-500/30 rounded-lg p-4 bg-red-500/5 hover:bg-red-500/10 transition-colors"
                          >
                            <div className="flex items-start justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
                                <span className="font-semibold text-red-400">
                                  {eventTypeLabels[log.eventType] || log.eventType || 'Unknown Violation'}
                                </span>
                              </div>
                              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                <Clock className="w-3 h-3" />
                                <span>{formatDate(log.timestamp)}</span>
                              </div>
                            </div>
                            
                            {log.metadata && Object.keys(log.metadata).length > 0 && (
                              <div className="mt-2 text-sm">
                                <div className="text-xs text-muted-foreground mb-1">Details:</div>
                                <div className="bg-slate-900/50 rounded p-2 font-mono text-xs">
                                  {Object.entries(log.metadata).map(([key, value]) => (
                                    <div key={key} className="mb-1">
                                      <span className="text-slate-400">{key}:</span>{' '}
                                      <span className="text-slate-200">
                                        {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {log.snapshotBase64 && (
                              <div className="mt-3">
                                <div className="text-xs text-muted-foreground mb-2">Evidence Snapshot:</div>
                                <img
                                  src={`data:image/png;base64,${log.snapshotBase64}`}
                                  alt="Violation snapshot"
                                  className="max-w-full h-auto rounded border border-slate-700"
                                  style={{ maxHeight: '200px' }}
                                />
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </CardContent>
                </Card>

                {/* Question Analytics */}
                {analytics.question_analytics.map((qa, index) => (
                  <Card key={qa.question_id}>
                    <CardContent className="p-6">
                      <h3 className="font-semibold text-lg mb-4">
                        Question {index + 1}: {qa.question_title}
                      </h3>
                      
                      <div className="grid grid-cols-2 gap-4 mb-4">
                        <div>
                          <div className="text-sm text-muted-foreground">Status</div>
                          <div className={`text-sm font-medium ${
                            qa.status === 'accepted' ? 'text-green-600' : 'text-red-600'
                          }`}>
                            {qa.status}
                          </div>
                        </div>
                        <div>
                          <div className="text-sm text-muted-foreground">Test Cases</div>
                          <div className="text-sm">
                            {qa.passed_testcases} / {qa.total_testcases} passed
                          </div>
                        </div>
                        <div>
                          <div className="text-sm text-muted-foreground">Language</div>
                          <div className="text-sm">{qa.language}</div>
                        </div>
                        {qa.execution_time && (
                          <div>
                            <div className="text-sm text-muted-foreground">Execution Time</div>
                            <div className="text-sm">{qa.execution_time}ms</div>
                          </div>
                        )}
                      </div>

                      {/* AI Feedback */}
                      {qa.ai_feedback && (
                        <div className="mt-6 border border-blue-500/30 rounded-lg bg-blue-500/5 overflow-hidden">
                          <div className="px-4 py-3 bg-blue-500/10 border-b border-blue-500/30">
                            <div className="flex items-center gap-3">
                              <Lightbulb className="w-5 h-5 text-blue-400" />
                              <span className="font-semibold text-blue-300">AI Feedback</span>
                              {qa.ai_feedback.overall_score !== undefined && (
                                <span className={`text-lg font-bold ${
                                  qa.ai_feedback.overall_score >= 80 ? 'text-green-400' :
                                  qa.ai_feedback.overall_score >= 60 ? 'text-yellow-400' : 'text-red-400'
                                }`}>
                                  Score: {qa.ai_feedback.overall_score}/100
                                </span>
                              )}
                            </div>
                          </div>
                          
                          <div className="p-4 space-y-4">
                            {/* Test Case Breakdown */}
                            {qa.ai_feedback.test_breakdown && (
                              <div className="bg-slate-900/50 rounded-lg p-3 border border-blue-500/20">
                                <h4 className="text-xs font-semibold text-slate-300 mb-2 flex items-center gap-2">
                                  <CheckCircle2 className="w-3 h-3" />
                                  Test Case Results
                                </h4>
                                <div className="grid grid-cols-2 gap-3 text-sm">
                                  <div className="bg-slate-800/50 rounded p-2">
                                    <div className="text-xs text-slate-400 mb-1">Public Test Cases</div>
                                    <div className="text-lg font-semibold text-blue-400">
                                      {qa.ai_feedback.test_breakdown?.public_passed ?? 0}/{qa.ai_feedback.test_breakdown?.public_total ?? 0}
                                    </div>
                                  </div>
                                  <div className="bg-slate-800/50 rounded p-2">
                                    <div className="text-xs text-slate-400 mb-1">Hidden Test Cases</div>
                                    <div className="text-lg font-semibold text-purple-400">
                                      {qa.ai_feedback.test_breakdown?.hidden_passed ?? 0}/{qa.ai_feedback.test_breakdown?.hidden_total ?? 0}
                                    </div>
                                  </div>
                                  <div className="col-span-2 bg-slate-800/50 rounded p-2">
                                    <div className="text-xs text-slate-400 mb-1">Total</div>
                                    <div className="text-lg font-semibold text-green-400">
                                      {(qa.ai_feedback.test_breakdown?.public_passed ?? 0) + (qa.ai_feedback.test_breakdown?.hidden_passed ?? 0)}/
                                      {(qa.ai_feedback.test_breakdown?.public_total ?? 0) + (qa.ai_feedback.test_breakdown?.hidden_total ?? 0)}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* Complexity */}
                            {qa.ai_feedback.efficiency && (
                              <div className="bg-slate-900/50 rounded-lg p-3">
                                <h4 className="text-xs font-semibold text-slate-300 mb-2 flex items-center gap-2">
                                  <TrendingUp className="w-3 h-3" />
                                  Complexity
                                </h4>
                                <div className="flex items-center gap-4 text-sm">
                                  <div>
                                    <span className="text-slate-400">Time: </span>
                                    <span className="font-semibold text-blue-400">
                                      {qa.ai_feedback.efficiency.time_complexity || 'N/A'}
                                    </span>
                                  </div>
                                  <div>
                                    <span className="text-slate-400">Space: </span>
                                    <span className="font-semibold text-purple-400">
                                      {qa.ai_feedback.efficiency.space_complexity || 'N/A'}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* AI Feedback Summary */}
                            {qa.ai_feedback.feedback_summary && (
                              <div className="bg-slate-900/50 rounded-lg p-3">
                                <h4 className="text-xs font-semibold text-slate-300 mb-2 flex items-center gap-2">
                                  <Lightbulb className="w-3 h-3" />
                                  AI Feedback
                                </h4>
                                <p className="text-sm text-slate-300 leading-relaxed">
                                  {qa.ai_feedback.feedback_summary}
                                </p>
                              </div>
                            )}

                          </div>
                        </div>
                      )}

                      {/* Code Display */}
                      <details className="mt-4">
                        <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground">
                          View Code
                        </summary>
                        <pre className="mt-2 p-4 bg-slate-900 rounded-lg overflow-x-auto text-xs">
                          <code>{qa.code}</code>
                        </pre>
                      </details>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

