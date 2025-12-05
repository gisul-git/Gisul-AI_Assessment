import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type ClipboardEvent as ReactClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useRouter } from "next/router";
import dynamic from "next/dynamic";
import axios from "axios";
import { useProctor, type ProctorViolation } from "@/hooks/useProctor";
import { useCameraProctor, type CameraProctorViolation } from "@/hooks/useCameraProctor";
import { useLiveProctor } from "@/hooks/useLiveProctor";
import { ProctorToast, FullscreenWarningBanner, ProctorDebugPanel } from "@/components/proctor";
import { EditorContainer, type SubmissionTestcaseResult } from "@/components/dsa/test/EditorContainer";
import type { SubmissionHistoryEntry } from "@/components/dsa/test/EditorContainer";
import { QuestionTabs } from "@/components/dsa/test/QuestionTabs";
import { getLanguageId, JUDGE0_ID_TO_LANG_NAME } from "@/lib/dsa/judge0";
import Split from 'react-split';

// Lazy load Monaco Editor
const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "400px", backgroundColor: "#1e1e1e", color: "#fff" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ width: "40px", height: "40px", border: "4px solid #3b82f6", borderTop: "4px solid transparent", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto 1rem" }} />
        <p>Loading code editor...</p>
      </div>
    </div>
  ),
});

// Judge0 Language ID to Monaco language mapping
const JUDGE0_TO_MONACO: { [key: string]: string } = {
  "50": "c",
  "54": "cpp",
  "62": "java",
  "71": "python",
  "70": "python",
  "63": "javascript",
  "74": "typescript",
  "68": "php",
  "72": "ruby",
  "83": "swift",
  "60": "go",
  "78": "kotlin",
  "73": "rust",
  "82": "sql",
  "51": "csharp",
  "84": "vb",
};

// Judge0 Language ID to display name
const JUDGE0_LANGUAGE_NAMES: { [key: string]: string } = {
  "50": "C",
  "54": "C++",
  "62": "Java",
  "71": "Python 3",
  "70": "Python 2",
  "63": "JavaScript",
  "74": "TypeScript",
  "68": "PHP",
  "72": "Ruby",
  "83": "Swift",
  "60": "Go",
  "78": "Kotlin",
  "73": "Rust",
  "82": "SQL",
  "51": "C#",
  "84": "VB.NET",
};

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
  // Coding question fields
  language?: string; // Judge0 language ID (e.g., "71" for Python)
  judge0_enabled?: boolean;
  coding_data?: {
    title?: string;
    description?: string;
    examples?: Array<{ input: string; output: string; explanation?: string | null }>;
    constraints?: string[];
    public_testcases?: Array<{ input: string; expected_output: string }>;
    hidden_testcases?: Array<{ input: string; expected_output: string }>;
    starter_code?: string | Record<string, string>;
    function_signature?: string;
  };
  starter_code?: string;
  public_testcases?: Array<{ input: string; expected_output: string }>;
  hidden_testcases?: Array<{ input: string; expected_output: string }>;
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
  const [enablePerSectionTimers, setEnablePerSectionTimers] = useState<boolean>(true); // Default to true
  const [questionsByType, setQuestionsByType] = useState<{ [key: string]: Question[] }>({});
  const [currentQuestionType, setCurrentQuestionType] = useState<string>("");
  const [typeTimeRemaining, setTypeTimeRemaining] = useState<number>(0);
  const [completedTypes, setCompletedTypes] = useState<Set<string>>(new Set());
  const [typeStartTime, setTypeStartTime] = useState<number>(Date.now());
  const [currentTypeQuestionIndex, setCurrentTypeQuestionIndex] = useState<number>(0);
  const [answerValidationError, setAnswerValidationError] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [savingAnswer, setSavingAnswer] = useState<boolean>(false);
  // Track last saved answer for each question to prevent duplicate logs
  const [lastSavedAnswers, setLastSavedAnswers] = useState<Map<number, string>>(new Map());
  const [clipboardWarning, setClipboardWarning] = useState<string | null>(null);
  const clipboardWarningTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [tabSwitchCount, setTabSwitchCount] = useState(0);
  const [latestViolation, setLatestViolation] = useState<ProctorViolation | null>(null);
  const [showFullscreenWarning, setShowFullscreenWarning] = useState(false);
  const [debugMode, setDebugMode] = useState(false);
  const [cameraProctorEnabled, setCameraProctorEnabled] = useState(false);
  
  // Coding question state (using DSA EditorContainer format)
  const [code, setCode] = useState<{ [questionIndex: number]: string }>({});
  const [language, setLanguage] = useState<{ [questionIndex: number]: string }>({});
  const [runningCode, setRunningCode] = useState<{ [questionIndex: number]: boolean }>({});
  const [submittingCode, setSubmittingCode] = useState<{ [questionIndex: number]: boolean }>({});
  const [codeOutput, setCodeOutput] = useState<{ [questionIndex: number]: { stdout?: string; stderr?: string; compileOutput?: string; status?: string; time?: number; memory?: number } }>({});
  const [publicResults, setPublicResults] = useState<{ [questionIndex: number]: SubmissionTestcaseResult[] }>({});
  const [hiddenSummary, setHiddenSummary] = useState<{ [questionIndex: number]: { total: number; passed: number } | null }>({});
  const [submissionHistory, setSubmissionHistory] = useState<{ [questionIndex: number]: SubmissionHistoryEntry[] }>({});
  
  // Pre-captured streams from instructions page for live proctoring
  const [preCapturedWebcamStream, setPreCapturedWebcamStream] = useState<MediaStream | null>(null);
  const [preCapturedScreenStream, setPreCapturedScreenStream] = useState<MediaStream | null>(null);

  // Check debug mode from URL params and camera proctor state + pre-captured streams
  useEffect(() => {
    if (typeof window !== "undefined") {
      const urlParams = new URLSearchParams(window.location.search);
      setDebugMode(urlParams.get("proctorDebug") === "true" || urlParams.get("cameraDebug") === "true");
      
      // Check if camera proctoring was enabled in instructions
      const cameraEnabled = sessionStorage.getItem("cameraProctorEnabled") === "true";
      setCameraProctorEnabled(cameraEnabled);
      
      // Get pre-captured streams from instructions page
      const webcamStream = (window as any).__webcamStream as MediaStream | undefined;
      const screenStream = (window as any).__screenStream as MediaStream | undefined;
      
      if (webcamStream && webcamStream.active) {
        console.log("[LiveProctor] Found pre-captured webcam stream");
        setPreCapturedWebcamStream(webcamStream);
      }
      
      if (screenStream && screenStream.active) {
        console.log("[LiveProctor] Found pre-captured screen stream");
        setPreCapturedScreenStream(screenStream);
      }
    }
  }, []);

  // Check if fullscreen was refused from instructions page
  useEffect(() => {
    if (typeof window !== "undefined") {
      const fullscreenAccepted = sessionStorage.getItem("fullscreenAccepted");
      setShowFullscreenWarning(fullscreenAccepted === "false");
    }
  }, []);

  // Enhanced proctoring with new hook
  const {
    isFullscreen,
    fullscreenRefused,
    violations,
    violationCount,
    recordViolation,
    requestFullscreen,
    exitFullscreen,
    setFullscreenRefused,
    simulateTabSwitch,
    simulateFullscreenExit,
  } = useProctor({
    userId: candidateEmail || "",
    assessmentId: (id as string) || "",
    onViolation: (violation) => {
      setTabSwitchCount((prev) => prev + 1);
      setLatestViolation(violation);
    },
    enableFullscreenDetection: true,
    enableDevToolsDetection: debugMode,
    debugMode,
  });

  // Camera-based proctoring hook
  const {
    isCameraOn,
    isModelLoaded,
    facesCount,
    lastViolation: lastCameraViolation,
    errors: cameraErrors,
    gazeDirection,
    isBlinking,
    startCamera,
    stopCamera,
    videoRef,
    canvasRef,
    debugInfo,
  } = useCameraProctor({
    userId: candidateEmail || "",
    assessmentId: (id as string) || "",
    onViolation: (violation) => {
      setTabSwitchCount((prev) => prev + 1);
      // Convert camera violation to proctor violation for unified display
      setLatestViolation({
        eventType: violation.eventType as any,
        timestamp: violation.timestamp,
        assessmentId: violation.assessmentId,
        userId: violation.userId,
        metadata: violation.metadata,
      });
    },
    enabled: cameraProctorEnabled,
    debugMode,
  });

  // Live proctoring hook for human proctoring (admin watching candidate)
  // Uses pre-captured streams from instructions page - NO permission dialogs!
  const {
    isStreaming: isLiveStreaming,
    connectionState: liveConnectionState,
  } = useLiveProctor({
    assessmentId: (id as string) || "",
    candidateId: candidateEmail || "",
    webcamStream: preCapturedWebcamStream,   // Pass pre-captured webcam
    screenStream: preCapturedScreenStream,   // Pass pre-captured screen
    onSessionStart: () => {
      console.log("[LiveProctor] Session started - admin is watching");
    },
    onSessionEnd: () => {
      console.log("[LiveProctor] Session ended");
    },
    onError: (error) => {
      console.error("[LiveProctor] Error:", error);
    },
    debugMode,
  });

  // Start camera when component mounts if camera proctoring is enabled
  useEffect(() => {
    if (cameraProctorEnabled && candidateEmail && id) {
      startCamera();
    }
    
    return () => {
      stopCamera();
    };
  }, [cameraProctorEnabled, candidateEmail, id]);

  // Handle fullscreen request from warning banner
  const handleEnterFullscreenFromBanner = async () => {
    const success = await requestFullscreen();
    if (success) {
      setShowFullscreenWarning(false);
      sessionStorage.setItem("fullscreenAccepted", "true");
    }
  };

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

        // Fetch questions, questionTypeTimes, and enablePerSectionTimers
        const questionsResponse = await axios.get(`/api/assessment/get-questions?assessmentId=${id}&token=${token}`);
        if (questionsResponse.data?.success) {
          const fetchedQuestions = questionsResponse.data.data.questions || [];
          const fetchedQuestionTypeTimes = questionsResponse.data.data.questionTypeTimes || {};
          const fetchedEnablePerSectionTimers = questionsResponse.data.data.enablePerSectionTimers !== undefined 
            ? questionsResponse.data.data.enablePerSectionTimers 
            : true; // Default to true for backward compatibility
          setQuestions(fetchedQuestions);
          setQuestionTypeTimes(fetchedQuestionTypeTimes);
          setEnablePerSectionTimers(fetchedEnablePerSectionTimers);
          
          // Initialize coding question code and language with starter code
          const initialCode: { [questionIndex: number]: string } = {};
          const initialLanguage: { [questionIndex: number]: string } = {};
          fetchedQuestions.forEach((q: Question, index: number) => {
            if (q.type === "coding" && q.judge0_enabled) {
              // Get starter code from coding_data or starter_code field
              const starterCode = q.coding_data?.starter_code || q.starter_code || "";
              // Get language name from language ID
              const langId = q.language || "71";
              const langName = JUDGE0_ID_TO_LANG_NAME[langId] || "python";
              
              // Handle both string and Record<string, string> formats
              if (typeof starterCode === "string") {
                initialCode[index] = starterCode || "";
              } else if (starterCode && typeof starterCode === "object") {
                initialCode[index] = starterCode[langName] || Object.values(starterCode)[0] || "";
              } else {
                initialCode[index] = "";
              }
              
              initialLanguage[index] = langName;
            }
          });
          setCode(initialCode);
          setLanguage(initialLanguage);
          
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
    // Clear validation error when question changes (but only if we're actually changing questions)
    // Use a ref or delay to avoid clearing too early
    const timeoutId = setTimeout(() => {
      setAnswerValidationError(false);
    }, 100);
    return () => clearTimeout(timeoutId);
  }, [currentQuestionIndex, currentQuestionType, questionsByType, questions.length, getTypeIndexFromGlobalIndex]);

  useEffect(() => {
    // Reset timer when question type changes (only if per-section timers are enabled)
    if (enablePerSectionTimers && currentQuestionType && questionTypeTimes[currentQuestionType] && !completedTypes.has(currentQuestionType)) {
      const typeTime = questionTypeTimes[currentQuestionType] || 10;
      setTypeTimeRemaining(typeTime * 60);
      setTypeStartTime(Date.now());
    }
  }, [currentQuestionType, questionTypeTimes, completedTypes]);

  useEffect(() => {
    // Per-question-type timer - only run if per-section timers are enabled
    if (!enablePerSectionTimers || !currentQuestionType || typeTimeRemaining <= 0 || timeStatus !== "active" || completedTypes.has(currentQuestionType)) return;
    
    const typeTimer = setInterval(() => {
          setTypeTimeRemaining(prev => {
        if (prev <= 1) {
          // Section timer expired - save current answer before locking section
          setAnswers(currentAnswers => {
            const currentAnswerEntry = currentAnswers.find((a) => a.questionIndex === currentQuestionIndex);
            const currentAnswerValue = currentAnswerEntry?.answer || "";
            const currentQuestion = questions[currentQuestionIndex];
            const questionType = currentQuestion?.type || "";

            // Save the current answer if it exists
            if (currentAnswerValue.trim()) {
              const timeSpent = Math.floor((Date.now() - typeStartTime) / 1000);
              const updatedAnswers = [...currentAnswers];
              const existingIndex = updatedAnswers.findIndex((a) => a.questionIndex === currentQuestionIndex);
              
              if (existingIndex >= 0) {
                updatedAnswers[existingIndex] = { questionIndex: currentQuestionIndex, answer: currentAnswerValue, timeSpent };
              } else {
                updatedAnswers.push({ questionIndex: currentQuestionIndex, answer: currentAnswerValue, timeSpent });
              }

              // Log answer for non-MCQ questions
              if (questionType !== "MCQ" && currentAnswerValue.trim()) {
                saveAnswerLogIfChanged(currentQuestionIndex, currentAnswerValue, questionType).catch((logError) => {
                  console.error("Error logging answer during section timer expiration:", logError);
                });
              }

              return updatedAnswers;
            }
            return currentAnswers;
          });

          // Section timer expired - lock this section and move to next type (if available)
          // DO NOT submit the entire assessment - only the overall assessment timer should do that
          setCompletedTypes(prev => {
            const newCompleted = new Set(prev);
            newCompleted.add(currentQuestionType);
            
            // Move to next question type if available
            const allTypes = Object.keys(questionsByType);
            const currentTypeIndex = allTypes.indexOf(currentQuestionType);
            if (currentTypeIndex < allTypes.length - 1) {
              const nextType = allTypes[currentTypeIndex + 1];
              // Only move to next type if it's not already completed
              if (!newCompleted.has(nextType)) {
                setCurrentQuestionType(nextType);
                setCurrentTypeQuestionIndex(0);
                const nextTypeFirstQuestion = questionsByType[nextType][0];
                const nextGlobalIndex = questions.findIndex((q) => q === nextTypeFirstQuestion);
                setCurrentQuestionIndex(nextGlobalIndex >= 0 ? nextGlobalIndex : 0);
                const nextTypeTime = questionTypeTimes[nextType] || 10;
                setTypeTimeRemaining(nextTypeTime * 60);
                setTypeStartTime(Date.now());
              }
            } else {
              // Last type completed - allow candidate to finalize immediately
              // Don't wait for overall assessment timer - they can finalize now
              setTypeTimeRemaining(0);
              // Note: Finalize button will be enabled even though section is marked as completed
            }
            
            return newCompleted;
          });
          
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(typeTimer);
  }, [enablePerSectionTimers, typeTimeRemaining, timeStatus, currentQuestionType, completedTypes, questionsByType, questionTypeTimes, questions, currentQuestionIndex, typeStartTime, saveAnswerLogIfChanged]);

  useEffect(() => {
    // Assessment-level timer
    if (!endTime || timeStatus !== "active" || submitting) return;
    
    const assessmentTimer = setInterval(() => {
      const now = new Date().getTime();
      const end = new Date(endTime).getTime();
      const remaining = Math.max(0, Math.floor((end - now) / 1000));
      setAssessmentTimeRemaining(remaining);
      
      if (remaining <= 0) {
        clearInterval(assessmentTimer);
        const autoSubmitAssessment = async () => {
          setSubmitting(true);
          let allAnswers = [...answers];

          // Ensure the current question's in-progress answer is captured
          const currentAnswerEntry = allAnswers.find((a) => a.questionIndex === currentQuestionIndex);
          const currentAnswerValue = currentAnswerEntry?.answer || "";
          const currentQuestion = questions[currentQuestionIndex];
          const questionType = currentQuestion?.type || "";

          if (currentAnswerValue.trim()) {
            const timeSpent = Math.floor((Date.now() - typeStartTime) / 1000);
            if (currentAnswerEntry) {
              currentAnswerEntry.timeSpent = timeSpent;
              currentAnswerEntry.answer = currentAnswerValue;
            } else {
              allAnswers = [
                ...allAnswers,
                { questionIndex: currentQuestionIndex, answer: currentAnswerValue, timeSpent },
              ];
            }

            try {
              await saveAnswerLogIfChanged(currentQuestionIndex, currentAnswerValue, questionType);
            } catch (logError) {
              console.error("Error logging answer during auto-submit:", logError);
            }
          }

          // Mark all unanswered questions as submitted / add empty answers
          questions.forEach((_, index) => {
            if (!submittedQuestions.has(index)) {
              const existingAnswer = allAnswers.find((a) => a.questionIndex === index);
              if (!existingAnswer) {
                allAnswers.push({ questionIndex: index, answer: "", timeSpent: 0 });
              }
            }
          });
          
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
            console.error("Error auto-submitting assessment:", err);
            setError(err.response?.data?.message || "Failed to submit assessment");
          } finally {
            setSubmitting(false);
          }
        };

        autoSubmitAssessment();
      }
    }, 1000);

    return () => clearInterval(assessmentTimer);
  }, [
    endTime,
    timeStatus,
    submitting,
    id,
    token,
    candidateEmail,
    candidateName,
    answers,
    questions,
    submittedQuestions,
    currentQuestionIndex,
    typeStartTime,
    saveAnswerLogIfChanged,
    router,
  ]);

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
    // Prevent answering if current section is completed (time expired) - only if per-section timers are enabled
    if (enablePerSectionTimers && completedTypes.has(currentQuestionType)) {
      return;
    }
    
    const timeSpent = Math.floor((Date.now() - typeStartTime) / 1000); // Time spent in current type
    const existingAnswerIndex = answers.findIndex((a) => a.questionIndex === currentQuestionIndex);
    
    if (existingAnswerIndex >= 0) {
      const updated = [...answers];
      updated[existingAnswerIndex] = { questionIndex: currentQuestionIndex, answer: value, timeSpent };
      setAnswers(updated);
    } else {
      setAnswers([...answers, { questionIndex: currentQuestionIndex, answer: value, timeSpent }]);
    }
    
    // Clear validation error when user provides an answer (for both MCQ and text-based)
    if (answerValidationError && validateAnswer(value)) {
      setAnswerValidationError(false);
    }
  };

  const showClipboardRestriction = useCallback((message: string) => {
    setClipboardWarning(message);
    if (clipboardWarningTimeoutRef.current) {
      clearTimeout(clipboardWarningTimeoutRef.current);
    }
    clipboardWarningTimeoutRef.current = setTimeout(() => {
      setClipboardWarning(null);
      clipboardWarningTimeoutRef.current = null;
    }, 2500);
  }, []);

  useEffect(() => {
    return () => {
      if (clipboardWarningTimeoutRef.current) {
        clearTimeout(clipboardWarningTimeoutRef.current);
      }
    };
  }, []);

  const handleClipboardEvent = useCallback(
    (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
      event.preventDefault();
      showClipboardRestriction(`Copy/paste is disabled during the assessment.`);
    },
    [showClipboardRestriction]
  );

  const handleContextMenuBlock = useCallback(
    (event: ReactMouseEvent<HTMLTextAreaElement>) => {
      event.preventDefault();
      showClipboardRestriction("Copy/paste is disabled during the assessment.");
    },
    [showClipboardRestriction]
  );

  const handleKeyDownGuard = useCallback(
    (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      const key = event.key.toLowerCase();
      const isClipboardCombo = (event.metaKey || event.ctrlKey) && ["c", "v", "x"].includes(key);
      const isShiftInsert = event.shiftKey && event.key === "Insert";
      if (isClipboardCombo || isShiftInsert) {
        event.preventDefault();
        showClipboardRestriction("Copy/paste is disabled during the assessment.");
      }
    },
    [showClipboardRestriction]
  );

  const validateAnswer = (answer: string): boolean => {
    // For MCQ, answer will be like "A", "B", etc. (not empty)
    // For text-based, answer should not be empty or only spaces
    return answer.trim().length > 0;
  };

  const isCurrentQuestionAnswered = (): boolean => {
    const currentAnswer = getCurrentAnswer();
    return validateAnswer(currentAnswer);
  };

  // Helper function to save answer log only if answer has changed
  async function saveAnswerLogIfChanged(
    questionIndex: number,
    answer: string,
    questionType: string
  ): Promise<boolean> {
    // Only log non-MCQ questions
    if (questionType === "MCQ" || !answer.trim()) {
      return false;
    }

    // Check if answer has changed from last saved version
    const lastSaved = lastSavedAnswers.get(questionIndex);
    if (lastSaved === answer.trim()) {
      // Answer hasn't changed, don't save
      return false;
    }

    // Answer has changed, save the log
    try {
      setSavingAnswer(true);
      setErrorMessage(null);
      setSuccessMessage(null);
      
      // Retry logic with exponential backoff
      let retries = 3;
      let delay = 1000;
      let lastError = null;
      
      while (retries > 0) {
        try {
          const response = await axios.post("/api/assessment/log-answer", {
            assessmentId: id,
            token,
            email: candidateEmail,
            name: candidateName,
            questionIndex: questionIndex,
            answer: answer.trim(),
            questionType: questionType,
          });
          
          if (response.data?.success) {
            // Update last saved answer
            setLastSavedAnswers(prev => {
              const newMap = new Map(prev);
              newMap.set(questionIndex, answer.trim());
              return newMap;
            });
            setSuccessMessage("Answer saved");
            setTimeout(() => setSuccessMessage(null), 2000);
            return true;
          } else {
            throw new Error(response.data?.message || "Failed to log answer");
          }
        } catch (err: any) {
          lastError = err;
          retries--;
          if (retries > 0) {
            await new Promise(resolve => setTimeout(resolve, delay));
            delay *= 2; // Exponential backoff
          }
        }
      }
      
      if (retries === 0 && lastError) {
        setErrorMessage("Failed to save answer log. Your answer is saved locally.");
        setTimeout(() => setErrorMessage(null), 3000);
        return false;
      }
      
      return false;
    } catch (err: any) {
      console.error("Error logging answer:", err);
      setErrorMessage("Failed to save answer log. Your answer is saved locally.");
      setTimeout(() => setErrorMessage(null), 3000);
      return false;
    } finally {
      setSavingAnswer(false);
    }
  }

  const handleSaveAndNext = async () => {
    // Save current answer and log it for non-MCQ questions (only if changed)
    const currentAnswer = getCurrentAnswer();
    const currentQuestion = questions[currentQuestionIndex];
    const questionType = currentQuestion?.type || "";
    
    // For coding questions, ensure code is saved in answers
    if (currentQuestion && currentQuestion.type === "coding" && currentQuestion.judge0_enabled) {
      const currentCode = code[currentQuestionIndex] || "";
      const timeSpent = Math.floor((Date.now() - typeStartTime) / 1000);
      const existingAnswerIndex = answers.findIndex((a) => a.questionIndex === currentQuestionIndex);
      
      if (existingAnswerIndex >= 0) {
        const updated = [...answers];
        updated[existingAnswerIndex] = { questionIndex: currentQuestionIndex, answer: currentCode, timeSpent };
        setAnswers(updated);
      } else {
        setAnswers([...answers, { questionIndex: currentQuestionIndex, answer: currentCode, timeSpent }]);
      }
      
      // Log answer only if it has changed from last saved version
      if (currentCode.trim()) {
        await saveAnswerLogIfChanged(currentQuestionIndex, currentCode, questionType);
      }
    } else {
      // Save the answer locally (already done in handleAnswerChange, but ensure it's saved)
      if (currentAnswer.trim()) {
        const timeSpent = Math.floor((Date.now() - typeStartTime) / 1000);
        const existingAnswerIndex = answers.findIndex((a) => a.questionIndex === currentQuestionIndex);
        
        if (existingAnswerIndex >= 0) {
          const updated = [...answers];
          updated[existingAnswerIndex] = { questionIndex: currentQuestionIndex, answer: currentAnswer, timeSpent };
          setAnswers(updated);
        } else {
          setAnswers([...answers, { questionIndex: currentQuestionIndex, answer: currentAnswer, timeSpent }]);
        }
        
        // Log answer only if it has changed from last saved version
        await saveAnswerLogIfChanged(currentQuestionIndex, currentAnswer, questionType);
      }
    }
    
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

  const handleBack = async () => {
    // Save current answer before navigating (only if changed)
    const currentAnswer = getCurrentAnswer();
    const currentQuestion = questions[currentQuestionIndex];
    const questionType = currentQuestion?.type || "";
    
    // Save the answer locally if it exists
    if (currentAnswer.trim()) {
      const timeSpent = Math.floor((Date.now() - typeStartTime) / 1000);
      const existingAnswerIndex = answers.findIndex((a) => a.questionIndex === currentQuestionIndex);
      
      if (existingAnswerIndex >= 0) {
        const updated = [...answers];
        updated[existingAnswerIndex] = { questionIndex: currentQuestionIndex, answer: currentAnswer, timeSpent };
        setAnswers(updated);
      } else {
        setAnswers([...answers, { questionIndex: currentQuestionIndex, answer: currentAnswer, timeSpent }]);
      }
      
      // Log answer only if it has changed from last saved version
      await saveAnswerLogIfChanged(currentQuestionIndex, currentAnswer, questionType);
    }
    
    // Clear validation error when navigating
    setAnswerValidationError(false);
    
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

  const handleSubmitSection = async () => {
    // Save and log current answer before submitting section (only if changed)
    const currentAnswer = getCurrentAnswer();
    const currentQuestion = questions[currentQuestionIndex];
    const questionType = currentQuestion?.type || "";
    
    // Save the answer locally
    if (currentAnswer.trim()) {
      const timeSpent = Math.floor((Date.now() - typeStartTime) / 1000);
      const existingAnswerIndex = answers.findIndex((a) => a.questionIndex === currentQuestionIndex);
      
      if (existingAnswerIndex >= 0) {
        const updated = [...answers];
        updated[existingAnswerIndex] = { questionIndex: currentQuestionIndex, answer: currentAnswer, timeSpent };
        setAnswers(updated);
      } else {
        setAnswers([...answers, { questionIndex: currentQuestionIndex, answer: currentAnswer, timeSpent }]);
      }
      
      // Log answer only if it has changed from last saved version
      await saveAnswerLogIfChanged(currentQuestionIndex, currentAnswer, questionType);
    }
    
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
    const currentQuestion = questions[currentQuestionIndex];
    // For coding questions, get code from code state
    if (currentQuestion && currentQuestion.type === "coding" && currentQuestion.judge0_enabled) {
      return code[currentQuestionIndex] || "";
    }
    // For other questions, get from answers
    const answer = answers.find((a) => a.questionIndex === currentQuestionIndex);
    return answer?.answer || "";
  };

  // Initialize code and language for coding questions when question changes
  useEffect(() => {
    const currentQuestion = questions[currentQuestionIndex];
    if (currentQuestion && currentQuestion.type === "coding" && currentQuestion.judge0_enabled) {
      // Get language name from language ID
      const langId = currentQuestion.language || "71";
      const langName = JUDGE0_ID_TO_LANG_NAME[langId] || "python";
      
      // Initialize language if not already set
      if (!language[currentQuestionIndex]) {
        setLanguage(prev => ({ ...prev, [currentQuestionIndex]: langName }));
      }
      
      // Initialize code if not already set
      if (!code[currentQuestionIndex]) {
        const starterCode = currentQuestion.coding_data?.starter_code || currentQuestion.starter_code || "";
        setCode(prev => ({ ...prev, [currentQuestionIndex]: starterCode || "" }));
      }
    }
  }, [currentQuestionIndex, questions]);

  // Handle code change for coding questions
  const handleCodeChange = (value: string | undefined) => {
    // Prevent code changes if section time has expired
    if (enablePerSectionTimers && completedTypes.has(currentQuestionType)) {
      return;
    }
    
    if (value !== undefined) {
      setCode(prev => ({ ...prev, [currentQuestionIndex]: value }));
      // Also update answer for submission
      const currentAnswer = answers.find((a) => a.questionIndex === currentQuestionIndex);
      if (currentAnswer) {
        setAnswers(prev => prev.map(a => 
          a.questionIndex === currentQuestionIndex 
            ? { ...a, answer: value }
            : a
        ));
      } else {
        setAnswers(prev => [...prev, {
          questionIndex: currentQuestionIndex,
          answer: value,
          timeSpent: Math.floor((Date.now() - questionStartTime) / 1000),
        }]);
      }
    }
  };

  // Handle run code for coding questions (using DSA EditorContainer format)
  const handleRunCode = async () => {
    // Prevent running if section time has expired
    if (enablePerSectionTimers && completedTypes.has(currentQuestionType)) {
      return;
    }
    
    const currentQuestion = questions[currentQuestionIndex];
    if (!currentQuestion || currentQuestion.type !== "coding" || !currentQuestion.judge0_enabled) {
      return;
    }

    const currentCode = code[currentQuestionIndex] || "";
    if (!currentCode.trim()) {
      setErrorMessage("Please write some code before running.");
      return;
    }

    setRunningCode(prev => ({ ...prev, [currentQuestionIndex]: true }));
    setCodeOutput(prev => ({ ...prev, [currentQuestionIndex]: {} }));
    setPublicResults(prev => ({ ...prev, [currentQuestionIndex]: [] }));

    try {
      const languageId = parseInt(currentQuestion.language || "71");
      const testcases = currentQuestion.coding_data?.public_testcases || currentQuestion.public_testcases || [];

      const response = await axios.post("/api/assessment/run-code", {
        assessmentId: id,
        token,
        questionIndex: currentQuestionIndex,
        sourceCode: currentCode,
        languageId: languageId,
        testcases: testcases,
      });

      if (response.data?.success) {
        const results = response.data.data.results || [];
        
        // Map results to EditorContainer format
        const mappedResults: SubmissionTestcaseResult[] = results.map((r: any) => ({
          visible: true,
          input: r.input || "",
          expected: r.expected || "",
          output: r.output || "",
          stdout: r.output || "",
          stderr: r.stderr || "",
          compile_output: r.compile_output || "",
          time: r.time || null,
          memory: r.memory || null,
          status: r.status || "",
          passed: r.passed || false,
        }));
        
        setPublicResults(prev => ({ ...prev, [currentQuestionIndex]: mappedResults }));
        
        const passedCount = results.filter((r: any) => r.passed).length;
        const totalCount = results.length;
        
        setCodeOutput(prev => ({
          ...prev,
          [currentQuestionIndex]: {
            stdout: passedCount === totalCount 
              ? `✅ All ${totalCount} public test cases passed!`
              : `❌ ${passedCount}/${totalCount} public test cases passed`,
            status: passedCount === totalCount ? "success" : "partial",
          },
        }));

        // Update answer with code
        handleCodeChange(currentCode);
      } else {
        setCodeOutput(prev => ({
          ...prev,
          [currentQuestionIndex]: {
            stderr: response.data?.message || "Failed to run code",
            status: "error",
          },
        }));
      }
    } catch (err: any) {
      console.error("Error running code:", err);
      setCodeOutput(prev => ({
        ...prev,
        [currentQuestionIndex]: {
          stderr: err.response?.data?.message || err.message || "Failed to run code",
          status: "error",
        },
      }));
    } finally {
      setRunningCode(prev => ({ ...prev, [currentQuestionIndex]: false }));
    }
  };

  // Handle submit code for coding questions (final submission) - using DSA EditorContainer format
  const handleSubmitCode = async () => {
    // Prevent submitting if section time has expired
    if (enablePerSectionTimers && completedTypes.has(currentQuestionType)) {
      return;
    }
    
    const currentQuestion = questions[currentQuestionIndex];
    if (!currentQuestion || currentQuestion.type !== "coding" || !currentQuestion.judge0_enabled) {
      return;
    }

    const currentCode = code[currentQuestionIndex] || "";
    if (!currentCode.trim()) {
      setErrorMessage("Please write some code before submitting.");
      return;
    }

    setSubmittingCode(prev => ({ ...prev, [currentQuestionIndex]: true }));

    try {
      const languageId = parseInt(currentQuestion.language || "71");
      const publicTestcases = currentQuestion.coding_data?.public_testcases || currentQuestion.public_testcases || [];
      const hiddenTestcases = currentQuestion.coding_data?.hidden_testcases || currentQuestion.hidden_testcases || [];

      const response = await axios.post("/api/assessment/submit-code", {
        assessmentId: id,
        token,
        questionIndex: currentQuestionIndex,
        sourceCode: currentCode,
        languageId: languageId,
        publicTestcases: publicTestcases,
        hiddenTestcases: hiddenTestcases,
      });

      if (response.data?.success) {
        const data = response.data.data;
        const publicResultsData = data.publicResults || [];
        
        // Map results to EditorContainer format
        const mappedResults: SubmissionTestcaseResult[] = publicResultsData.map((r: any) => ({
          visible: true,
          input: r.input || "",
          expected: r.expected || "",
          output: r.output || "",
          stdout: r.output || "",
          stderr: r.stderr || "",
          compile_output: r.compile_output || "",
          time: r.time || null,
          memory: r.memory || null,
          status: r.status || "",
          passed: r.passed || false,
        }));
        
        setPublicResults(prev => ({ ...prev, [currentQuestionIndex]: mappedResults }));
        setHiddenSummary(prev => ({ 
          ...prev, 
          [currentQuestionIndex]: data.hiddenTotal > 0 
            ? { total: data.hiddenTotal, passed: data.hiddenPassed || 0 }
            : null 
        }));
        
        const passedCount = data.publicPassed || 0;
        const totalCount = data.publicTotal || 0;
        const hiddenPassed = data.hiddenPassed || 0;
        const hiddenTotal = data.hiddenTotal || 0;
        
        setCodeOutput(prev => ({
          ...prev,
          [currentQuestionIndex]: {
            stdout: `Public: ${passedCount}/${totalCount} passed${hiddenTotal > 0 ? ` | Hidden: ${hiddenPassed}/${hiddenTotal} passed` : ""}`,
            status: "submitted",
          },
        }));

        // Create submission history entry
        const historyEntry: SubmissionHistoryEntry = {
          id: `${currentQuestionIndex}-${Date.now()}`,
          status: passedCount === totalCount && (hiddenTotal === 0 || hiddenPassed === hiddenTotal) ? "accepted" : "partial",
          passed: passedCount,
          total: totalCount,
          score: passedCount,
          max_score: totalCount,
          created_at: new Date().toISOString(),
          results: mappedResults,
          public_results: mappedResults,
          hidden_results: [],
          hidden_summary: hiddenTotal > 0 ? { total: hiddenTotal, passed: hiddenPassed } : undefined,
        };
        
        setSubmissionHistory(prev => ({
          ...prev,
          [currentQuestionIndex]: [historyEntry, ...(prev[currentQuestionIndex] || [])].slice(0, 5),
        }));

        // Update answer with code and mark as submitted
        handleCodeChange(currentCode);
        setSubmittedQuestions(prev => {
          const newSet = new Set(prev);
          newSet.add(currentQuestionIndex);
          return newSet;
        });

        setSuccessMessage("Code submitted successfully!");
        setTimeout(() => setSuccessMessage(null), 3000);
      } else {
        setCodeOutput(prev => ({
          ...prev,
          [currentQuestionIndex]: {
            stderr: response.data?.message || "Failed to submit code",
            status: "error",
          },
        }));
      }
    } catch (err: any) {
      console.error("Error submitting code:", err);
      setCodeOutput(prev => ({
        ...prev,
        [currentQuestionIndex]: {
          stderr: err.response?.data?.message || err.message || "Failed to submit code",
          status: "error",
        },
      }));
    } finally {
      setSubmittingCode(prev => ({ ...prev, [currentQuestionIndex]: false }));
    }
  };

  // Handle reset code for coding questions
  const handleResetCode = () => {
    const currentQuestion = questions[currentQuestionIndex];
    if (!currentQuestion || currentQuestion.type !== "coding" || !currentQuestion.judge0_enabled) {
      return;
    }
    
    const starterCode = currentQuestion.coding_data?.starter_code || currentQuestion.starter_code || "";
    const langId = currentQuestion.language || "71";
    const langName = JUDGE0_ID_TO_LANG_NAME[langId] || "python";
    
    // Handle both string and Record<string, string> formats
    let resetCode = "";
    if (typeof starterCode === "string") {
      resetCode = starterCode || "";
    } else if (starterCode && typeof starterCode === "object") {
      resetCode = starterCode[langName] || Object.values(starterCode)[0] || "";
    }
    
    setCode(prev => ({ ...prev, [currentQuestionIndex]: resetCode }));
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
            Your Assessment is Over
          </h1>
          <p style={{ color: "#6b6678", marginBottom: "2rem", fontSize: "1.125rem" }}>
            Your assessment ended at:
          </p>
          <p style={{ fontSize: "1.5rem", color: "#ef4444", fontWeight: 600, marginBottom: "2rem" }}>
            {formatDateTime(endTime)}
          </p>
          <p style={{ color: "#64748b", fontSize: "0.875rem" }}>
            The assessment time has expired. Your answers have been submitted.
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
              {/* Error and Success Messages */}
              {errorMessage && (
                <div style={{
                  padding: "1rem",
                  backgroundColor: "#fef2f2",
                  border: "1px solid #ef4444",
                  borderRadius: "0.5rem",
                  marginBottom: "1rem",
                  color: "#dc2626",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center"
                }}>
                  <span>{errorMessage}</span>
                  <button
                    type="button"
                    onClick={() => setErrorMessage(null)}
                    style={{
                      background: "none",
                      border: "none",
                      color: "#dc2626",
                      cursor: "pointer",
                      fontSize: "1.25rem",
                      padding: "0 0.5rem"
                    }}
                  >
                    ×
                  </button>
                </div>
              )}
              {successMessage && (
                <div style={{
                  padding: "1rem",
                  backgroundColor: "#f0fdf4",
                  border: "1px solid #10b981",
                  borderRadius: "0.5rem",
                  marginBottom: "1rem",
                  color: "#059669",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center"
                }}>
                  <span>{successMessage}</span>
                  <button
                    type="button"
                    onClick={() => setSuccessMessage(null)}
                    style={{
                      background: "none",
                      border: "none",
                      color: "#059669",
                      cursor: "pointer",
                      fontSize: "1.25rem",
                      padding: "0 0.5rem"
                    }}
                  >
                    ×
                  </button>
                </div>
              )}
              {clipboardWarning && (
                <div style={{
                  padding: "0.85rem",
                  backgroundColor: "#fffbeb",
                  border: "1px solid #fbbf24",
                  borderRadius: "0.5rem",
                  marginBottom: "1rem",
                  color: "#92400e",
                }}>
                  {clipboardWarning}
                </div>
              )}
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

                {/* Type Timer - Right (only show if per-section timers are enabled) */}
                {enablePerSectionTimers && timeStatus === "active" && currentQuestionType && !completedTypes.has(currentQuestionType) && (
                  <div style={{ 
                    marginLeft: "1rem",
                    textAlign: "right",
                    padding: "0.75rem 1rem",
                    backgroundColor: typeTimeRemaining < 60 ? "#fef2f2" : "#f0f9ff",
                    border: `2px solid ${typeTimeRemaining < 60 ? "#ef4444" : "#3b82f6"}`,
                    borderRadius: "0.5rem",
                    minWidth: "100px"
                  }}>
                    <p style={{ color: "#64748b", fontSize: "0.75rem", marginBottom: "0.25rem" }}>Section Time</p>
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

          {/* Question and Answer Area */}
          {currentQuestion.type === "coding" && currentQuestion.judge0_enabled ? (
            /* Side-by-side layout for coding questions (like DSA) */
            <div style={{ marginBottom: "1.5rem", height: "calc(100vh - 350px)", minHeight: "650px" }}>
              {/* Warning if section time expired */}
              {enablePerSectionTimers && completedTypes.has(currentQuestionType) && (
                <div style={{ 
                  marginBottom: "1rem", 
                  padding: "1rem", 
                  backgroundColor: "#fef2f2", 
                  border: "2px solid #ef4444", 
                  borderRadius: "0.5rem",
                  color: "#dc2626"
                }}>
                  <strong>⚠️ This section's time has expired. You can no longer edit or run code.</strong>
                </div>
              )}
              
              <div style={{ 
                opacity: (enablePerSectionTimers && completedTypes.has(currentQuestionType)) ? 0.6 : 1,
                pointerEvents: (enablePerSectionTimers && completedTypes.has(currentQuestionType)) ? "none" : "auto",
                height: "100%",
                border: "1px solid #e2e8f0",
                borderRadius: "0.5rem",
                overflow: "hidden",
                backgroundColor: "#ffffff"
              }}>
                <Split
                  className="flex h-full"
                  direction="horizontal"
                  minSize={[300, 400]}
                  sizes={[40, 60]}
                  gutterSize={4}
                  gutterStyle={() => ({
                    backgroundColor: '#e2e8f0',
                    cursor: 'col-resize',
                  })}
                >
                  {/* Left side - Question tabs */}
                  <div className="h-full overflow-hidden bg-white border-r border-slate-200">
                    {currentQuestion.coding_data?.title ? (
                      <QuestionTabs
                        question={{
                          id: `q_${currentQuestionIndex}`,
                          title: currentQuestion.coding_data.title || "Coding Question",
                          description: currentQuestion.coding_data.description || currentQuestion.questionText || "",
                          examples: currentQuestion.coding_data.examples || [],
                          constraints: currentQuestion.coding_data.constraints || [],
                          difficulty: currentQuestion.difficulty,
                          public_testcases: currentQuestion.coding_data.public_testcases || currentQuestion.public_testcases || [],
                          hidden_testcases: currentQuestion.coding_data.hidden_testcases || currentQuestion.hidden_testcases || [],
                        }}
                      />
                    ) : (
                      <div style={{ padding: "1.5rem", height: "100%", overflowY: "auto" }}>
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
                        <p style={{ color: "#1e293b", lineHeight: 1.6, whiteSpace: "pre-wrap", fontSize: "0.9375rem" }}>
                          {currentQuestion.questionText}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Right side - Code editor */}
                  <div className="h-full overflow-hidden bg-slate-950">
                    <EditorContainer
                      code={code[currentQuestionIndex] || ""}
                      language={language[currentQuestionIndex] || JUDGE0_ID_TO_LANG_NAME[currentQuestion.language || "71"] || "python"}
                      languages={[JUDGE0_ID_TO_LANG_NAME[currentQuestion.language || "71"] || "python"]}
                      starterCode={(() => {
                        const langName = JUDGE0_ID_TO_LANG_NAME[currentQuestion.language || "71"] || "python";
                        const starterCode = currentQuestion.coding_data?.starter_code || currentQuestion.starter_code || "";
                        if (typeof starterCode === "string") {
                          return { [langName]: starterCode };
                        } else if (starterCode && typeof starterCode === "object") {
                          return starterCode;
                        }
                        return { [langName]: "" };
                      })()}
                      onCodeChange={(value) => handleCodeChange(value)}
                      onLanguageChange={() => {}}
                      onRun={handleRunCode}
                      onSubmit={handleSubmitCode}
                      onReset={handleResetCode}
                      running={runningCode[currentQuestionIndex] || false}
                      submitting={submittingCode[currentQuestionIndex] || false}
                      output={codeOutput[currentQuestionIndex]}
                      submissions={submissionHistory[currentQuestionIndex] || []}
                      visibleTestcases={(currentQuestion.coding_data?.public_testcases || currentQuestion.public_testcases || []).map((tc: any, idx: number) => ({
                        id: `tc_${idx}`,
                        input: tc.input || "",
                        expected: tc.expected_output || "",
                      }))}
                      publicResults={publicResults[currentQuestionIndex] || []}
                      hiddenSummary={hiddenSummary[currentQuestionIndex] || null}
                    />
                  </div>
                </Split>
              </div>
            </div>
          ) : (
            /* Regular layout for non-coding questions */
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

              {/* Answer Input - Disabled if section is completed */}
              {enablePerSectionTimers && completedTypes.has(currentQuestionType) && (
                <div style={{ 
                  marginBottom: "1rem", 
                  padding: "1rem", 
                  backgroundColor: "#fef2f2", 
                  border: "2px solid #ef4444", 
                  borderRadius: "0.5rem",
                  color: "#dc2626"
                }}>
                  <strong>⚠️ This section's time has expired. You can no longer answer questions in this section.</strong>
                </div>
              )}

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
                        border: `2px solid ${getCurrentAnswer() === String.fromCharCode(65 + optIndex) ? "#3b82f6" : answerValidationError ? "#ef4444" : "#e2e8f0"}`,
                        borderRadius: "0.5rem",
                        cursor: (enablePerSectionTimers && completedTypes.has(currentQuestionType)) ? "not-allowed" : "pointer",
                        transition: "all 0.2s",
                        opacity: (enablePerSectionTimers && completedTypes.has(currentQuestionType)) ? 0.6 : 1,
                      }}
                    >
                      <input
                        type="radio"
                        name="answer"
                        value={String.fromCharCode(65 + optIndex)}
                        checked={getCurrentAnswer() === String.fromCharCode(65 + optIndex)}
                        onChange={(e) => handleAnswerChange(e.target.value)}
                        disabled={enablePerSectionTimers && completedTypes.has(currentQuestionType)}
                        style={{ marginRight: "0.5rem" }}
                      />
                      <span style={{ fontSize: "0.875rem", color: "#1e293b" }}>
                        {String.fromCharCode(65 + optIndex)}. {option}
                      </span>
                    </label>
                  ))}
                  {answerValidationError && (
                    <p style={{
                      color: "#ef4444",
                      fontSize: "0.875rem",
                      marginTop: "0.5rem",
                      marginBottom: 0,
                    }}>
                      Please select an option before proceeding.
                    </p>
                  )}
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
          )}

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
                    onClick={handleSaveAndNext}
                    className="btn-primary"
                    disabled={submitting || savingAnswer}
                    style={{ 
                      padding: "0.5rem 1rem",
                      fontSize: "0.875rem",
                      flex: isFirstQuestionInType ? 1 : 2,
                      marginLeft: isFirstQuestionInType ? "auto" : 0
                    }}
                  >
                    {savingAnswer ? "Saving..." : "Save & Next"}
                  </button>
                )}
                {isLastQuestionInType && (
                  <button
                    type="button"
                    onClick={handleSubmitSection}
                    className="btn-primary"
                    disabled={submitting || (completedTypes.has(currentQuestionType) && !isLastType)}
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

      {/* Proctoring Components */}
      
      {/* Fullscreen Warning Banner - shown if user refused fullscreen */}
      <FullscreenWarningBanner
        isVisible={showFullscreenWarning && !isFullscreen}
        onEnterFullscreen={handleEnterFullscreenFromBanner}
      />
      
      {/* Violation Toast Notification */}
      <ProctorToast
        violation={latestViolation}
        duration={4000}
        onDismiss={() => setLatestViolation(null)}
      />
      
      {/* Hidden video and canvas elements for camera proctoring */}
      {cameraProctorEnabled && (
        <>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            style={{
              position: "absolute",
              top: "-9999px",
              left: "-9999px",
              width: "640px",
              height: "360px",
              opacity: 0,
              pointerEvents: "none",
            }}
          />
          <canvas
            ref={canvasRef}
            style={{ display: "none" }}
          />
        </>
      )}
      
      {/* Debug Panel - only shown when proctorDebug=true in URL */}
      <ProctorDebugPanel
        isVisible={debugMode}
        violations={violations}
        isFullscreen={isFullscreen}
        fullscreenRefused={fullscreenRefused || showFullscreenWarning}
        onSimulateTabSwitch={simulateTabSwitch}
        onSimulateFullscreenExit={simulateFullscreenExit}
        onRequestFullscreen={requestFullscreen}
        onExitFullscreen={exitFullscreen}
      />

      {/* Live Streaming Indicator */}
      {isLiveStreaming && (
        <div
          style={{
            position: "fixed",
            top: "1rem",
            right: "1rem",
            backgroundColor: "#dc2626",
            color: "white",
            padding: "0.5rem 1rem",
            borderRadius: "9999px",
            fontSize: "0.75rem",
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            zIndex: 9998,
            boxShadow: "0 4px 6px rgba(0, 0, 0, 0.2)",
          }}
        >
          <span
            style={{
              width: "8px",
              height: "8px",
              backgroundColor: "white",
              borderRadius: "50%",
              animation: "pulse 1.5s infinite",
            }}
          />
          LIVE - Proctor Watching
        </div>
      )}
    </div>
  );
}
