import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/router";
import axios from "axios";

interface Question {
  questionText: string;
  type: string;
  difficulty: string;
  options?: string[];
  correctAnswer?: string;
  idealAnswer?: string;
  expectedLogic?: string;
  time?: number;
  score?: number;
  topic?: string;
}

export default function CandidateAssessmentPage() {
  const router = useRouter();
  const { id, token } = router.query;
  const [startTime, setStartTime] = useState<string | null>(null);
  const [endTime, setEndTime] = useState<string | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Array<{ questionIndex: number; answer: string; timeSpent: number }>>([]);
  const [submittedQuestions, setSubmittedQuestions] = useState<Set<number>>(new Set());
  const [questionStartTime, setQuestionStartTime] = useState<number>(Date.now());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeStatus, setTimeStatus] = useState<"before" | "active" | "ended">("before");
  const [candidateEmail, setCandidateEmail] = useState<string | null>(null);
  const [candidateName, setCandidateName] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submittingQuestion, setSubmittingQuestion] = useState<number | null>(null);
  const [assessmentTimeRemaining, setAssessmentTimeRemaining] = useState<number>(0);
  const [questionTypeTimes, setQuestionTypeTimes] = useState<{ [key: string]: number }>({});
  const [questionsByType, setQuestionsByType] = useState<{ [key: string]: Question[] }>({});
  const [currentQuestionType, setCurrentQuestionType] = useState<string>("");
  const [typeTimeRemaining, setTypeTimeRemaining] = useState<number>(0);
  const [completedTypes, setCompletedTypes] = useState<Set<string>>(new Set());
  const [typeStartTime, setTypeStartTime] = useState<number>(Date.now());
  const [currentTypeQuestionIndex, setCurrentTypeQuestionIndex] = useState<number>(0);

  useEffect(() => {
    // Get candidate info from sessionStorage
    const email = sessionStorage.getItem("candidateEmail");
    const name = sessionStorage.getItem("candidateName");
    
    if (!email || !name) {
      router.push(`/assessment/${id}/${token}`);
      return;
    }

    setCandidateEmail(email);
    setCandidateName(name);

    // Fetch assessment data
    const fetchAssessment = async () => {
      try {
        // Fetch schedule
        const scheduleResponse = await axios.get(`/api/assessment/get-schedule?assessmentId=${id}&token=${token}`);
        if (scheduleResponse.data?.success) {
          setStartTime(scheduleResponse.data.data.startTime);
          setEndTime(scheduleResponse.data.data.endTime);
        }

        // Fetch questions and questionTypeTimes
        const questionsResponse = await axios.get(`/api/assessment/get-questions?assessmentId=${id}&token=${token}`);
        if (questionsResponse.data?.success) {
          const fetchedQuestions = questionsResponse.data.data.questions || [];
          const fetchedQuestionTypeTimes = questionsResponse.data.data.questionTypeTimes || {};
          setQuestions(fetchedQuestions);
          setQuestionTypeTimes(fetchedQuestionTypeTimes);
          
          // Group questions by type and set current type
          const questionsByType: { [key: string]: Question[] } = {};
          fetchedQuestions.forEach((q: Question) => {
            const type = q.type || "Other";
            if (!questionsByType[type]) {
              questionsByType[type] = [];
            }
            questionsByType[type].push(q);
          });
          
          setQuestionsByType(questionsByType);
          
          // Set first question type as current
          const firstType = Object.keys(questionsByType)[0];
          if (firstType) {
            setCurrentQuestionType(firstType);
            setCurrentTypeQuestionIndex(0);
            // Find the global index of first question of first type
            const firstQuestionOfType = questionsByType[firstType][0];
            const globalIndex = fetchedQuestions.findIndex((q: Question) => q === firstQuestionOfType);
            setCurrentQuestionIndex(globalIndex >= 0 ? globalIndex : 0);
            // Initialize timer for first question type
            const typeTime = fetchedQuestionTypeTimes[firstType] || 10;
            setTypeTimeRemaining(typeTime * 60);
            setTypeStartTime(Date.now());
          }
        }

        // Check time status
        checkTimeStatus(scheduleResponse.data.data.startTime, scheduleResponse.data.data.endTime);
      } catch (err: any) {
        console.error("Error fetching assessment:", err);
        setError(err.response?.data?.message || "Failed to load assessment");
      } finally {
        setLoading(false);
      }
    };

    if (id && token) {
      fetchAssessment();
    }
  }, [id, token, router]);

  // Helper functions for question type navigation
  const getCurrentTypeQuestions = useCallback(() => {
    if (!currentQuestionType || !questionsByType[currentQuestionType]) return [];
    return questionsByType[currentQuestionType];
  }, [currentQuestionType, questionsByType]);

  const getGlobalIndexFromTypeIndex = useCallback((typeIndex: number) => {
    if (!currentQuestionType || !questionsByType[currentQuestionType]) return -1;
    const typeQuestion = questionsByType[currentQuestionType][typeIndex];
    if (!typeQuestion) return -1;
    return questions.findIndex((q) => q === typeQuestion);
  }, [currentQuestionType, questionsByType, questions]);

  const getTypeIndexFromGlobalIndex = useCallback((globalIndex: number) => {
    if (!currentQuestionType || !questionsByType[currentQuestionType]) return -1;
    const question = questions[globalIndex];
    if (!question) return -1;
    return questionsByType[currentQuestionType].findIndex((q) => q === question);
  }, [currentQuestionType, questionsByType, questions]);

  useEffect(() => {
    // Update current type question index when global index changes
    if (currentQuestionType && questionsByType[currentQuestionType] && questions.length > 0) {
      const typeIndex = getTypeIndexFromGlobalIndex(currentQuestionIndex);
      if (typeIndex >= 0) {
        setCurrentTypeQuestionIndex(typeIndex);
      }
    }
  }, [currentQuestionIndex, currentQuestionType, questionsByType, questions.length, getTypeIndexFromGlobalIndex]);

  useEffect(() => {
    // Reset timer when question type changes
    if (currentQuestionType && questionTypeTimes[currentQuestionType] && !completedTypes.has(currentQuestionType)) {
      const typeTime = questionTypeTimes[currentQuestionType] || 10;
      setTypeTimeRemaining(typeTime * 60);
      setTypeStartTime(Date.now());
    }
  }, [currentQuestionType, questionTypeTimes, completedTypes]);

  useEffect(() => {
    // Per-question-type timer
    if (!currentQuestionType || typeTimeRemaining <= 0 || timeStatus !== "active" || completedTypes.has(currentQuestionType)) return;
    
    const typeTimer = setInterval(() => {
          setTypeTimeRemaining(prev => {
        if (prev <= 1) {
          // Auto-submit current type - mark as completed and move to next type
          setCompletedTypes(prev => {
            const newCompleted = new Set(prev);
            newCompleted.add(currentQuestionType);
            
            // Move to next question type
            const allTypes = Object.keys(questionsByType);
            const currentTypeIndex = allTypes.indexOf(currentQuestionType);
            if (currentTypeIndex < allTypes.length - 1) {
              const nextType = allTypes[currentTypeIndex + 1];
              setCurrentQuestionType(nextType);
              setCurrentTypeQuestionIndex(0);
              const nextTypeFirstQuestion = questionsByType[nextType][0];
              const nextGlobalIndex = questions.findIndex((q) => q === nextTypeFirstQuestion);
              setCurrentQuestionIndex(nextGlobalIndex >= 0 ? nextGlobalIndex : 0);
              const nextTypeTime = questionTypeTimes[nextType] || 10;
              setTypeTimeRemaining(nextTypeTime * 60);
              setTypeStartTime(Date.now());
            } else {
              // Last type completed, finalize assessment
              // Use setTimeout to avoid calling handleFinalize during state update
              setTimeout(() => {
                const allAnswers = [...answers];
                questions.forEach((_, index) => {
                  const existingAnswer = allAnswers.find((a) => a.questionIndex === index);
                  if (!existingAnswer) {
                    allAnswers.push({ questionIndex: index, answer: "", timeSpent: 0 });
                  }
                });
                setSubmitting(true);
                axios.post("/api/assessment/submit-answers", {
                  assessmentId: id,
                  token,
                  email: candidateEmail,
                  name: candidateName,
                  answers: allAnswers,
                  skippedQuestions: [],
                }).then((response) => {
                  if (response.data?.success) {
                    router.push(`/assessment/${id}/${token}/completed`);
                  }
                }).catch((err) => {
                  console.error("Error auto-submitting assessment:", err);
                }).finally(() => {
                  setSubmitting(false);
                });
              }, 100);
            }
            
            return newCompleted;
          });
          
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(typeTimer);
  }, [typeTimeRemaining, timeStatus, currentQuestionType, completedTypes, questionsByType, questionTypeTimes, questions, answers, id, token, candidateEmail, candidateName, router]);

  useEffect(() => {
    // Assessment-level timer
    if (!endTime || timeStatus !== "active" || submitting) return;
    
    const assessmentTimer = setInterval(() => {
      const now = new Date().getTime();
      const end = new Date(endTime).getTime();
      const remaining = Math.max(0, Math.floor((end - now) / 1000));
      setAssessmentTimeRemaining(remaining);
      
      if (remaining <= 0) {
        // Auto-submit entire assessment - submit all answers
        setSubmitting(true);
        const allAnswers = [...answers];
        // Mark all unanswered questions as submitted
        questions.forEach((_, index) => {
          if (!submittedQuestions.has(index)) {
            const existingAnswer = allAnswers.find((a) => a.questionIndex === index);
            if (existingAnswer) {
              // Answer exists, include it
            } else {
              // No answer, add empty answer
              allAnswers.push({ questionIndex: index, answer: "", timeSpent: 0 });
            }
          }
        });
        
        axios.post("/api/assessment/submit-answers", {
          assessmentId: id,
          token,
          email: candidateEmail,
          name: candidateName,
          answers: allAnswers,
          skippedQuestions: [],
        }).then((response) => {
          if (response.data?.success) {
            router.push(`/assessment/${id}/${token}/completed`);
          }
        }).catch((err) => {
          console.error("Error auto-submitting assessment:", err);
        }).finally(() => {
          setSubmitting(false);
        });
      }
    }, 1000);

    return () => clearInterval(assessmentTimer);
  }, [endTime, timeStatus, submitting, id, token, candidateEmail, candidateName, answers, questions, submittedQuestions, router]);

  useEffect(() => {
    // Check time status periodically
    const interval = setInterval(() => {
      if (startTime && endTime) {
        checkTimeStatus(startTime, endTime);
      }
    }, 1000); // Check every second

    return () => clearInterval(interval);
  }, [startTime, endTime]);

  const checkTimeStatus = (start: string | null, end: string | null) => {
    if (!start || !end) return;
    
    const now = new Date();
    const startDate = new Date(start);
    const endDate = new Date(end);

    if (now < startDate) {
      setTimeStatus("before");
    } else if (now > endDate) {
      setTimeStatus("ended");
    } else {
      setTimeStatus("active");
    }
  };

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

  const handleAnswerChange = (value: string) => {
    // Free navigation - no restrictions
    const timeSpent = Math.floor((Date.now() - typeStartTime) / 1000); // Time spent in current type
    const existingAnswerIndex = answers.findIndex((a) => a.questionIndex === currentQuestionIndex);
    
    if (existingAnswerIndex >= 0) {
      const updated = [...answers];
      updated[existingAnswerIndex] = { questionIndex: currentQuestionIndex, answer: value, timeSpent };
      setAnswers(updated);
    } else {
      setAnswers([...answers, { questionIndex: currentQuestionIndex, answer: value, timeSpent }]);
    }
  };

  const handleNext = () => {
    // Move to next question within current type
    const currentTypeQuestions = getCurrentTypeQuestions();
    if (currentTypeQuestionIndex < currentTypeQuestions.length - 1) {
      const nextTypeIndex = currentTypeQuestionIndex + 1;
      setCurrentTypeQuestionIndex(nextTypeIndex);
      const nextGlobalIndex = getGlobalIndexFromTypeIndex(nextTypeIndex);
      if (nextGlobalIndex >= 0) {
        setCurrentQuestionIndex(nextGlobalIndex);
      }
    }
  };

  const handleBack = () => {
    // Move to previous question within current type
    if (currentTypeQuestionIndex > 0) {
      const prevTypeIndex = currentTypeQuestionIndex - 1;
      setCurrentTypeQuestionIndex(prevTypeIndex);
      const prevGlobalIndex = getGlobalIndexFromTypeIndex(prevTypeIndex);
      if (prevGlobalIndex >= 0) {
        setCurrentQuestionIndex(prevGlobalIndex);
      }
    }
  };

  const handleSubmitSection = () => {
    // Mark current type as completed and move to next type
    setCompletedTypes(prev => {
      const newSet = new Set(prev);
      newSet.add(currentQuestionType);
      return newSet;
    });
    
    // Move to next question type
    const allTypes = Object.keys(questionsByType);
    const currentTypeIndex = allTypes.indexOf(currentQuestionType);
    if (currentTypeIndex < allTypes.length - 1) {
      const nextType = allTypes[currentTypeIndex + 1];
      setCurrentQuestionType(nextType);
      setCurrentTypeQuestionIndex(0);
      const nextTypeFirstQuestion = questionsByType[nextType][0];
      const nextGlobalIndex = questions.findIndex((q) => q === nextTypeFirstQuestion);
      setCurrentQuestionIndex(nextGlobalIndex >= 0 ? nextGlobalIndex : 0);
      const nextTypeTime = questionTypeTimes[nextType] || 10;
      setTypeTimeRemaining(nextTypeTime * 60);
      setTypeStartTime(Date.now());
    } else {
      // Last type, finalize assessment
      handleFinalize();
    }
  };

  const handleTypeClick = (type: string) => {
    // Only allow clicking the current active type (not completed types)
    if (type === currentQuestionType && !completedTypes.has(type)) {
      setCurrentQuestionType(type);
      setCurrentTypeQuestionIndex(0);
      const typeFirstQuestion = questionsByType[type][0];
      const globalIndex = questions.findIndex((q) => q === typeFirstQuestion);
      setCurrentQuestionIndex(globalIndex >= 0 ? globalIndex : 0);
      const typeTime = questionTypeTimes[type] || 10;
      setTypeTimeRemaining(typeTime * 60);
      setTypeStartTime(Date.now());
    }
  };

  const handleFinalize = async () => {
    // Auto-submit all remaining answers
    const allAnswers = [...answers];
    questions.forEach((_, index) => {
      if (!submittedQuestions.has(index)) {
        const existingAnswer = allAnswers.find((a) => a.questionIndex === index);
        if (existingAnswer) {
          // Answer exists, mark as submitted
          setSubmittedQuestions(prev => {
            const newSet = new Set(prev);
            newSet.add(index);
            return newSet;
          });
        }
      }
    });

    setSubmitting(true);
    try {
      const response = await axios.post("/api/assessment/submit-answers", {
        assessmentId: id,
        token,
        email: candidateEmail,
        name: candidateName,
        answers: allAnswers,
        skippedQuestions: [],
      });

      if (response.data?.success) {
        router.push(`/assessment/${id}/${token}/completed`);
      } else {
        setError("Failed to submit assessment");
      }
    } catch (err: any) {
      console.error("Error submitting assessment:", err);
      setError(err.response?.data?.message || "Failed to submit assessment");
    } finally {
      setSubmitting(false);
    }
  };

  const getCurrentAnswer = () => {
    const answer = answers.find((a) => a.questionIndex === currentQuestionIndex);
    return answer?.answer || "";
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

  // Check time restrictions
  if (timeStatus === "before") {
    return (
      <div style={{ backgroundColor: "#f1dcba", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem" }}>
        <div className="card" style={{ maxWidth: "600px", width: "100%", textAlign: "center" }}>
          <h1 style={{ marginBottom: "1rem", fontSize: "2rem", color: "#1a1625", fontWeight: 700 }}>
            Assessment Not Started
          </h1>
          <p style={{ color: "#6b6678", marginBottom: "2rem", fontSize: "1.125rem" }}>
            Your assessment starts at:
          </p>
          <p style={{ fontSize: "1.5rem", color: "#6953a3", fontWeight: 600, marginBottom: "2rem" }}>
            {formatDateTime(startTime)}
          </p>
          <p style={{ color: "#64748b", fontSize: "0.875rem" }}>
            Please come back at the scheduled time.
          </p>
        </div>
      </div>
    );
  }

  if (timeStatus === "ended") {
    return (
      <div style={{ backgroundColor: "#f1dcba", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem" }}>
        <div className="card" style={{ maxWidth: "600px", width: "100%", textAlign: "center" }}>
          <h1 style={{ marginBottom: "1rem", fontSize: "2rem", color: "#1a1625", fontWeight: 700 }}>
            Time Over
          </h1>
          <p style={{ color: "#6b6678", marginBottom: "2rem", fontSize: "1.125rem" }}>
            Your assessment ended at:
          </p>
          <p style={{ fontSize: "1.5rem", color: "#ef4444", fontWeight: 600, marginBottom: "2rem" }}>
            {formatDateTime(endTime)}
          </p>
          <p style={{ color: "#64748b", fontSize: "0.875rem" }}>
            The assessment time has expired.
          </p>
        </div>
      </div>
    );
  }

  if (questions.length === 0) {
    return (
      <div style={{ backgroundColor: "#f1dcba", minHeight: "100vh", padding: "2rem" }}>
        <div className="container">
          <div className="card">
            <h1 style={{ marginBottom: "0.5rem", fontSize: "2rem", color: "#1a1625", fontWeight: 700 }}>
              Assessment
            </h1>
            <p style={{ color: "#64748b", textAlign: "center", padding: "2rem" }}>
              No questions available for this assessment.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const currentTypeQuestions = getCurrentTypeQuestions();
  const currentQuestion = questions[currentQuestionIndex];
  const isLastQuestionInType = currentTypeQuestionIndex === currentTypeQuestions.length - 1;
  const isFirstQuestionInType = currentTypeQuestionIndex === 0;
  const allTypes = Object.keys(questionsByType);
  const isLastType = allTypes.indexOf(currentQuestionType) === allTypes.length - 1;

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div style={{ backgroundColor: "#f1dcba", minHeight: "100vh", padding: "2rem" }}>
      <div className="container">
        <div style={{ display: "flex", gap: "1.5rem" }}>
          {/* Left Sidebar - Question Types */}
          <div style={{ 
            width: "200px", 
            backgroundColor: "#ffffff", 
            borderRadius: "0.5rem", 
            padding: "1rem",
            border: "1px solid #e2e8f0",
            height: "fit-content",
            position: "sticky",
            top: "2rem"
          }}>
            <h3 style={{ marginBottom: "1rem", fontSize: "1rem", color: "#1a1625", fontWeight: 700 }}>
              Question Types
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {allTypes.map((type) => {
                const isActive = type === currentQuestionType;
                const isCompleted = completedTypes.has(type);
                const isClickable = isActive && !isCompleted;
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => handleTypeClick(type)}
                    disabled={!isClickable}
                    style={{
                      padding: "0.75rem",
                      textAlign: "left",
                      backgroundColor: isActive ? "#6953a3" : isCompleted ? "#10b981" : "#f8fafc",
                      color: isActive ? "#ffffff" : isCompleted ? "#ffffff" : "#64748b",
                      border: `2px solid ${isActive ? "#6953a3" : isCompleted ? "#10b981" : "#e2e8f0"}`,
                      borderRadius: "0.5rem",
                      cursor: isClickable ? "pointer" : "not-allowed",
                      fontWeight: isActive ? 700 : 500,
                      fontSize: "0.875rem",
                      transition: "all 0.2s",
                      opacity: isCompleted ? 0.7 : 1,
                      position: "relative",
                    }}
                    title={isCompleted ? "Section completed - Cannot revisit" : isActive ? "Current section" : "Not available"}
                  >
                    {type}
                    {isCompleted && " ✓"}
                    {isCompleted && (
                      <span style={{ 
                        position: "absolute", 
                        right: "0.5rem", 
                        fontSize: "0.75rem",
                        opacity: 0.8
                      }}>
                        🔒
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Main Content Area */}
          <div style={{ flex: 1 }}>
            <div className="card">
              {/* Top Bar - Assessment Timer (center) and Type Timer (right) */}
              <div style={{ 
                display: "flex", 
                justifyContent: "space-between", 
                alignItems: "center",
                marginBottom: "1.5rem",
                paddingBottom: "1rem",
                borderBottom: "2px solid #e2e8f0"
              }}>
                {/* Assessment Timer - Center */}
                {timeStatus === "active" && (
                  <div style={{ 
                    flex: 1,
                    textAlign: "center",
                    padding: "0.75rem",
                    backgroundColor: assessmentTimeRemaining < 300 ? "#fef2f2" : "#f0f9ff",
                    border: `2px solid ${assessmentTimeRemaining < 300 ? "#ef4444" : "#3b82f6"}`,
                    borderRadius: "0.5rem",
                  }}>
                    <p style={{ color: "#64748b", fontSize: "0.75rem", marginBottom: "0.25rem" }}>
                      Assessment ends in:
                    </p>
                    <p style={{ 
                      fontSize: "1.25rem", 
                      fontWeight: 700, 
                      color: assessmentTimeRemaining < 300 ? "#dc2626" : "#1e40af"
                    }}>
                      {formatTime(assessmentTimeRemaining)}
                    </p>
                  </div>
                )}

                {/* Type Timer - Right */}
                {timeStatus === "active" && currentQuestionType && !completedTypes.has(currentQuestionType) && (
                  <div style={{ 
                    marginLeft: "1rem",
                    textAlign: "right",
                    padding: "0.75rem 1rem",
                    backgroundColor: typeTimeRemaining < 60 ? "#fef2f2" : "#f0f9ff",
                    border: `2px solid ${typeTimeRemaining < 60 ? "#ef4444" : "#3b82f6"}`,
                    borderRadius: "0.5rem",
                    minWidth: "100px"
                  }}>
                    <p style={{ color: "#64748b", fontSize: "0.75rem", marginBottom: "0.25rem" }}>Time</p>
                    <p style={{ 
                      fontSize: "1rem", 
                      fontWeight: 700, 
                      color: typeTimeRemaining < 60 ? "#dc2626" : "#1e293b"
                    }}>
                      {formatTime(typeTimeRemaining)}
                    </p>
                  </div>
                )}
              </div>

              {/* Question Navigation within Current Type (1->2->3) */}
              <div style={{ marginBottom: "1.5rem", padding: "1rem", backgroundColor: "#f8fafc", borderRadius: "0.5rem", border: "1px solid #e2e8f0" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", justifyContent: "center", flexWrap: "wrap" }}>
                  {currentTypeQuestions.map((_, idx) => {
                    const globalIdx = getGlobalIndexFromTypeIndex(idx);
                    const isAnswered = globalIdx >= 0 && answers.some((a) => a.questionIndex === globalIdx);
                    const isCurrent = idx === currentTypeQuestionIndex;
                    return (
                      <div key={idx} style={{ display: "flex", alignItems: "center" }}>
                        <div
                          style={{
                            width: isCurrent ? "36px" : "32px",
                            height: isCurrent ? "36px" : "32px",
                            borderRadius: "50%",
                            backgroundColor: isCurrent ? "#6953a3" : isAnswered ? "#3b82f6" : "#e2e8f0",
                            color: isCurrent || isAnswered ? "#ffffff" : "#64748b",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: isCurrent ? "0.875rem" : "0.75rem",
                            fontWeight: 700,
                            cursor: "pointer",
                            border: isCurrent ? "3px solid #6953a3" : "2px solid transparent",
                            transition: "all 0.2s",
                          }}
                          onClick={() => {
                            const nextGlobalIndex = getGlobalIndexFromTypeIndex(idx);
                            if (nextGlobalIndex >= 0) {
                              setCurrentTypeQuestionIndex(idx);
                              setCurrentQuestionIndex(nextGlobalIndex);
                            }
                          }}
                          title={`Question ${idx + 1} of ${currentTypeQuestions.length}${isAnswered ? " (Answered)" : ""}`}
                        >
                          {idx + 1}
                        </div>
                        {idx < currentTypeQuestions.length - 1 && (
                          <div
                            style={{
                              width: "20px",
                              height: "2px",
                              backgroundColor: isCurrent || idx < currentTypeQuestionIndex ? "#6953a3" : "#cbd5e1",
                              margin: "0 2px",
                            }}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
                <div style={{ textAlign: "center", marginTop: "0.5rem", fontSize: "0.75rem", color: "#64748b" }}>
                  Question {currentTypeQuestionIndex + 1} of {currentTypeQuestions.length} ({currentQuestionType})
                </div>
              </div>

          {error && (
            <div className="alert alert-error" style={{ marginBottom: "1.5rem" }}>
              {error}
            </div>
          )}

          {/* Question */}
          <div style={{ marginBottom: "1.5rem" }}>
            <div style={{ marginBottom: "0.75rem", display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
              <span
                style={{
                  backgroundColor: "#eff6ff",
                  color: "#1e40af",
                  padding: "0.2rem 0.6rem",
                  borderRadius: "9999px",
                  fontSize: "0.7rem",
                  fontWeight: 600,
                }}
              >
                {currentQuestion.type}
              </span>
              <span
                style={{
                  backgroundColor: "#fef3c7",
                  color: "#92400e",
                  padding: "0.2rem 0.6rem",
                  borderRadius: "9999px",
                  fontSize: "0.7rem",
                  fontWeight: 500,
                }}
              >
                {currentQuestion.difficulty}
              </span>
              <span
                style={{
                  backgroundColor: "#f0fdf4",
                  color: "#166534",
                  padding: "0.2rem 0.6rem",
                  borderRadius: "9999px",
                  fontSize: "0.7rem",
                  fontWeight: 500,
                }}
              >
                {currentQuestion.score || 5} pts
              </span>
            </div>

            <p style={{ color: "#1e293b", lineHeight: 1.6, whiteSpace: "pre-wrap", marginBottom: "1rem", fontSize: "0.9375rem" }}>
              {currentQuestion.questionText}
            </p>

              {/* Answer Input - Free navigation, no restrictions */}
              {currentQuestion.type === "MCQ" && currentQuestion.options ? (
                <div style={{ marginTop: "1rem" }}>
                  {currentQuestion.options.map((option, optIndex) => (
                    <label
                      key={optIndex}
                      style={{
                        display: "block",
                        padding: "0.75rem",
                        marginBottom: "0.5rem",
                        backgroundColor: getCurrentAnswer() === String.fromCharCode(65 + optIndex) ? "#eff6ff" : "#f8fafc",
                        border: `2px solid ${getCurrentAnswer() === String.fromCharCode(65 + optIndex) ? "#3b82f6" : "#e2e8f0"}`,
                        borderRadius: "0.5rem",
                        cursor: "pointer",
                        transition: "all 0.2s",
                      }}
                    >
                      <input
                        type="radio"
                        name="answer"
                        value={String.fromCharCode(65 + optIndex)}
                        checked={getCurrentAnswer() === String.fromCharCode(65 + optIndex)}
                        onChange={(e) => handleAnswerChange(e.target.value)}
                        style={{ marginRight: "0.5rem" }}
                      />
                      <span style={{ fontSize: "0.875rem", color: "#1e293b" }}>
                        {String.fromCharCode(65 + optIndex)}. {option}
                      </span>
                    </label>
                  ))}
                </div>
              ) : (
                <textarea
                  value={getCurrentAnswer()}
                  onChange={(e) => handleAnswerChange(e.target.value)}
                  placeholder="Enter your answer here..."
                  rows={6}
                  style={{
                    width: "100%",
                    padding: "0.75rem",
                    border: "1px solid #e2e8f0",
                    borderRadius: "0.5rem",
                    fontSize: "0.875rem",
                    fontFamily: "inherit",
                    resize: "vertical",
                    backgroundColor: "#ffffff",
                  }}
                />
              )}
          </div>

              {/* Navigation - Within Current Type */}
              <div style={{ display: "flex", gap: "0.75rem", marginTop: "1.5rem", paddingTop: "1.5rem", borderTop: "1px solid #e2e8f0" }}>
                {!isFirstQuestionInType && (
                  <button
                    type="button"
                    onClick={handleBack}
                    className="btn-secondary"
                    disabled={submitting}
                    style={{ 
                      padding: "0.5rem 1rem",
                      fontSize: "0.875rem",
                      flex: 1
                    }}
                  >
                    Back
                  </button>
                )}
                {!isLastQuestionInType && (
                  <button
                    type="button"
                    onClick={handleNext}
                    className="btn-primary"
                    disabled={submitting}
                    style={{ 
                      padding: "0.5rem 1rem",
                      fontSize: "0.875rem",
                      flex: isFirstQuestionInType ? 1 : 2,
                      marginLeft: isFirstQuestionInType ? "auto" : 0
                    }}
                  >
                    Next
                  </button>
                )}
                {isLastQuestionInType && (
                  <button
                    type="button"
                    onClick={handleSubmitSection}
                    className="btn-primary"
                    disabled={submitting || completedTypes.has(currentQuestionType)}
                    style={{ 
                      padding: "0.5rem 1rem",
                      fontSize: "0.875rem",
                      flex: isFirstQuestionInType ? 1 : 2,
                      marginLeft: isFirstQuestionInType ? "auto" : 0
                    }}
                  >
                    {isLastType ? (submitting ? "Submitting..." : "Finalize Assessment") : "Submit Section & Continue"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
