import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/router";
import { GetServerSideProps } from "next";
import { requireAuth } from "../../lib/auth";
import Link from "next/link";
import axios from "axios";

const QUESTION_TYPES = ["MCQ", "Subjective", "Pseudo Code", "Descriptive", "coding"];
const DIFFICULTY_LEVELS = ["Easy", "Medium", "Hard"];

interface QuestionTypeConfig {
  questionType: string;
  difficulty: string;
  numQuestions: number;
  language?: string; // Selected language ID
  judge0_enabled?: boolean; // Whether Judge0 is enabled
}

interface Topic {
  topic: string;
  questionTypeConfigs: QuestionTypeConfig[]; // Multiple question types per topic
  // For aptitude topics
  isAptitude?: boolean;
  subTopic?: string; // Selected sub-topic (e.g., "Number Systems")
  aptitudeStructure?: {
    subTopics: {
      [key: string]: string[]; // Sub-topic name -> question types
    };
  };
  availableSubTopics?: string[]; // List of available sub-topics for this main topic
  coding_supported?: boolean; // Whether this topic supports coding questions
}

export default function CreateNewAssessmentPage() {
  const router = useRouter();
  const { id } = router.query; // Get assessment ID from URL query params if editing
  const isEditMode = !!(id && typeof id === 'string'); // True if we have an ID (editing draft)
  
  const [currentStation, setCurrentStation] = useState(1);
  const [jobDesignation, setJobDesignation] = useState("");
  const [topicCards, setTopicCards] = useState<string[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [manualSkillInput, setManualSkillInput] = useState("");
  const [loadingCards, setLoadingCards] = useState(false);
  const [topics, setTopics] = useState<string[]>([]);
  const [experienceMin, setExperienceMin] = useState(0);
  const [experienceMax, setExperienceMax] = useState(10);
  const [availableQuestionTypes, setAvailableQuestionTypes] = useState<string[]>(QUESTION_TYPES);
  const [topicConfigs, setTopicConfigs] = useState<Topic[]>([]);
  const [questions, setQuestions] = useState<any[]>([]);
  const [assessmentId, setAssessmentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingDraft, setLoadingDraft] = useState(false); // Loading existing draft data
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finalTitle, setFinalTitle] = useState("");
  const [finalDescription, setFinalDescription] = useState("");
  const [passPercentage, setPassPercentage] = useState<number>(75);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [candidates, setCandidates] = useState<Array<{ email: string; name: string }>>([]);
  const [candidateEmail, setCandidateEmail] = useState("");
  const [candidateName, setCandidateName] = useState("");
  const [assessmentUrl, setAssessmentUrl] = useState<string | null>(null);
  const [questionTypeTimes, setQuestionTypeTimes] = useState<{ [key: string]: number }>({});
  const [enablePerSectionTimers, setEnablePerSectionTimers] = useState<boolean>(true); // Default to enabled
  const [hasVisitedConfigureStation, setHasVisitedConfigureStation] = useState(false);
  const [hasVisitedReviewStation, setHasVisitedReviewStation] = useState(false);
  // Edit mode is always enabled - removed isConfigureEditMode state
  const [previewGenerating, setPreviewGenerating] = useState(false);
  const [previewQuestions, setPreviewQuestions] = useState<any[]>([]);
  const [previewProgress, setPreviewProgress] = useState({ current: 0, total: 0 });
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [currentPreviewIndex, setCurrentPreviewIndex] = useState(0);
  const [editingQuestionIndex, setEditingQuestionIndex] = useState<number | null>(null);
  const [editingQuestion, setEditingQuestion] = useState<any>(null);
  const [regeneratingQuestionIndex, setRegeneratingQuestionIndex] = useState<number | null>(null);
  const [customTopicInput, setCustomTopicInput] = useState("");
  const [regeneratingTopicIndex, setRegeneratingTopicIndex] = useState<number | null>(null);
  const [uploadingCsv, setUploadingCsv] = useState(false);

  const sliderRef = useRef<HTMLDivElement>(null);
  const originalTopicConfigsRef = useRef<Topic[]>([]);
  const minHandleRef = useRef<HTMLDivElement>(null);
  const maxHandleRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const dragTargetRef = useRef<"min" | "max" | null>(null);
  const experienceRef = useRef({ min: experienceMin, max: experienceMax });

  // Update ref when state changes
  useEffect(() => {
    experienceRef.current = { min: experienceMin, max: experienceMax };
    if (minHandleRef.current && maxHandleRef.current) {
      const minPercent = (experienceMin / 20) * 100;
      const maxPercent = (experienceMax / 20) * 100;
      minHandleRef.current.style.left = `${minPercent}%`;
      maxHandleRef.current.style.left = `${maxPercent}%`;
    }
  }, [experienceMin, experienceMax]);

  // Handle experience range slider
  useEffect(() => {
    // Only initialize slider when on Station 1
    if (currentStation !== 1) return;
    if (!sliderRef.current || !minHandleRef.current || !maxHandleRef.current) return;

    const slider = sliderRef.current;
    const minHandle = minHandleRef.current;
    const maxHandle = maxHandleRef.current;

    const getValueFromPosition = (x: number) => {
      const rect = slider.getBoundingClientRect();
      const percentage = Math.max(0, Math.min(100, ((x - rect.left) / rect.width) * 100));
      return Math.round((percentage / 100) * 20); // 0-20 years range
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current || !dragTargetRef.current) return;
      
      const value = getValueFromPosition(e.clientX);
      const { min: currentMin, max: currentMax } = experienceRef.current;
      
      if (dragTargetRef.current === "min") {
        const newMin = Math.max(0, Math.min(value, currentMax - 1));
        experienceRef.current.min = newMin;
        const minPercent = (newMin / 20) * 100;
        minHandle.style.left = `${minPercent}%`;
        setExperienceMin(newMin);
      } else {
        const newMax = Math.max(currentMin + 1, Math.min(value, 20));
        experienceRef.current.max = newMax;
        const maxPercent = (newMax / 20) * 100;
        maxHandle.style.left = `${maxPercent}%`;
        setExperienceMax(newMax);
      }
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
      dragTargetRef.current = null;
    };

    const minMouseDown = (e: MouseEvent) => {
      isDraggingRef.current = true;
      dragTargetRef.current = "min";
      e.preventDefault();
      e.stopPropagation();
    };
    
    const maxMouseDown = (e: MouseEvent) => {
      isDraggingRef.current = true;
      dragTargetRef.current = "max";
      e.preventDefault();
      e.stopPropagation();
    };

    minHandle.addEventListener("mousedown", minMouseDown);
    maxHandle.addEventListener("mousedown", maxMouseDown);
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    // Initial position
    const minPercent = (experienceMin / 20) * 100;
    const maxPercent = (experienceMax / 20) * 100;
    minHandle.style.left = `${minPercent}%`;
    maxHandle.style.left = `${maxPercent}%`;

    return () => {
      minHandle.removeEventListener("mousedown", minMouseDown);
      maxHandle.removeEventListener("mousedown", maxMouseDown);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [currentStation, experienceMin, experienceMax]);

  // Load existing draft assessment data when in edit mode (via URL id parameter)
  // For "Create New Assessment", do NOT load from localStorage - start fresh
  useEffect(() => {
    if (isEditMode && id && typeof id === 'string') {
      // Edit mode: load the draft assessment specified in URL
      loadDraftAssessment(id);
    } else if (!isEditMode && !assessmentId) {
      // Not in edit mode and no assessmentId - check localStorage for existing draft
      // This helps preserve the assessment when user navigates back
      try {
        const savedDraftId = localStorage.getItem('currentDraftAssessmentId');
        if (savedDraftId && savedDraftId.trim()) {
          // Verify the assessment still exists before using it
          axios.get(`/api/assessments/get-questions?assessmentId=${savedDraftId}`)
            .then((response) => {
              if (response.data?.success) {
                // Assessment exists, use it
                setAssessmentId(savedDraftId);
                // Optionally load the draft data
                // loadDraftAssessment(savedDraftId);
              } else {
                // Assessment doesn't exist, clear invalid ID
                localStorage.removeItem('currentDraftAssessmentId');
              }
            })
            .catch(() => {
              // Assessment doesn't exist or error, clear invalid ID
              localStorage.removeItem('currentDraftAssessmentId');
            });
        }
      } catch (err) {
        console.error("Error checking localStorage for draft ID:", err);
      }
    }
  }, [isEditMode, id, assessmentId]);

  // Store assessment ID in localStorage whenever it changes (for draft recovery)
  useEffect(() => {
    if (!assessmentId) return;
    try {
      localStorage.setItem('currentDraftAssessmentId', assessmentId);
    } catch (err) {
      console.error("Error saving draft ID to localStorage:", err);
    }
  }, [assessmentId]);

  // Keep preview index within bounds when questions change (but don't interfere with user navigation)
  useEffect(() => {
    const questionsToShow = previewQuestions.length > 0 ? previewQuestions : questions;
    const totalQuestions = questionsToShow.length;
    
    // Only adjust if index is truly out of bounds (don't run on every index change)
    if (totalQuestions > 0) {
      setCurrentPreviewIndex((prevIndex) => {
        // Only adjust if index is out of bounds
        if (prevIndex >= totalQuestions) {
          const newIndex = totalQuestions - 1;
          console.log(`[Preview] Index out of bounds, adjusting: ${prevIndex} -> ${newIndex} (total: ${totalQuestions})`);
          return newIndex;
        } else if (prevIndex < 0) {
          console.log(`[Preview] Index negative, resetting to 0`);
          return 0;
        }
        // Otherwise, preserve the current index (user navigation)
        return prevIndex;
      });
    }
  }, [previewQuestions.length, questions.length]); // Removed currentPreviewIndex from dependencies

  // Save draft only when navigating away (browser back button or route change)
  useEffect(() => {
    if (!assessmentId) return;

    const saveDraftOnNavigation = async () => {
      try {
        // Ensure we have a title - use job designation as fallback
        const titleToSave = finalTitle || (jobDesignation.trim() ? `Assessment for ${jobDesignation.trim()}` : "Untitled Assessment");
        
        const draftData: any = {
          assessmentId: assessmentId,
          title: titleToSave,
          description: finalDescription || "",
          jobDesignation: jobDesignation.trim(),
          selectedSkills: selectedSkills,
          experienceMin: experienceMin,
          experienceMax: experienceMax,
        };

        // Add topics if configured
        if (topicConfigs.length > 0) {
          draftData.topics = topicConfigs;
        }

        // Add preview questions if available
        if (previewQuestions.length > 0) {
          draftData.previewQuestions = previewQuestions;
        }

        // Add questions if available
        if (questions.length > 0) {
          draftData.questions = questions;
          draftData.questionTypeTimes = questionTypeTimes;
          draftData.enablePerSectionTimers = enablePerSectionTimers;
          draftData.passPercentage = passPercentage;
        }

        // Add schedule if available
        if (startTime && endTime) {
          const normalizeDateTime = (dt: string): string => {
            if (!dt) return dt;
            if (dt.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)) {
              const dtWithSeconds = dt + ":00";
              const istDate = new Date(dtWithSeconds + "+05:30");
              if (!isNaN(istDate.getTime())) {
                return istDate.toISOString();
              } else {
                return dt + ":00Z";
              }
            }
            if (dt.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/)) {
              return dt + "Z";
            }
            return dt;
          };
          
          draftData.schedule = {
            startTime: normalizeDateTime(startTime),
            endTime: normalizeDateTime(endTime),
          };
        }

        // Add candidates if available
        if (candidates.length > 0) {
          draftData.candidates = candidates;
        }

        if (assessmentUrl) {
          draftData.assessmentUrl = assessmentUrl;
        }

        // Fire-and-forget save (don't await, don't block navigation)
        axios.put("/api/assessments/update-draft", draftData).catch((err) => {
          console.error("Error saving draft on navigation:", err);
        });
      } catch (err: any) {
        console.error("Error preparing draft data:", err);
      }
    };

    // Save on beforeunload (browser back/close/navigation)
    const handleBeforeUnload = () => {
      // Use synchronous XMLHttpRequest for beforeunload (most reliable)
      try {
        // Ensure we have a title - use job designation as fallback
        const titleToSave = finalTitle || (jobDesignation.trim() ? `Assessment for ${jobDesignation.trim()}` : "Untitled Assessment");
        
        const draftData: any = {
          assessmentId: assessmentId,
          title: titleToSave,
          description: finalDescription || "",
          jobDesignation: jobDesignation.trim(),
          selectedSkills: selectedSkills,
          experienceMin: experienceMin,
          experienceMax: experienceMax,
        };
        if (topicConfigs.length > 0) draftData.topics = topicConfigs;
        if (previewQuestions.length > 0) draftData.previewQuestions = previewQuestions;
        if (questions.length > 0) {
          draftData.questions = questions;
          draftData.questionTypeTimes = questionTypeTimes;
          draftData.enablePerSectionTimers = enablePerSectionTimers;
          draftData.passPercentage = passPercentage;
        }
        if (startTime && endTime) {
          const normalizeDateTime = (dt: string): string => {
            if (!dt) return dt;
            if (dt.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)) {
              return dt + ":00Z";
            }
            if (dt.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/)) {
              return dt + "Z";
            }
            return dt;
          };
          draftData.schedule = {
            startTime: normalizeDateTime(startTime),
            endTime: normalizeDateTime(endTime),
          };
        }
        if (candidates.length > 0) draftData.candidates = candidates;
        if (assessmentUrl) draftData.assessmentUrl = assessmentUrl;
        
        // Synchronous XHR for beforeunload (only reliable way)
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', '/api/assessments/update-draft', false); // Synchronous
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.send(JSON.stringify(draftData));
      } catch (err) {
        console.error("Error in beforeunload draft save:", err);
      }
    };

    // Save on route change (Next.js router navigation away from this page)
    const handleRouteChange = (url: string) => {
      // Only save if navigating away from create-new page
      if (!url.includes('/assessments/create-new')) {
        saveDraftOnNavigation();
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    if (router.events) {
      router.events.on('routeChangeStart', handleRouteChange);
    }

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (router.events) {
        router.events.off('routeChangeStart', handleRouteChange);
      }
    };
  }, [
    assessmentId,
    finalTitle,
    finalDescription,
    jobDesignation,
    selectedSkills,
    experienceMin,
    experienceMax,
    topicConfigs,
    previewQuestions,
    questions,
    questionTypeTimes,
    enablePerSectionTimers,
    passPercentage,
    startTime,
    endTime,
    candidates,
    assessmentUrl,
    router
  ]);

  // Auto-fetch skills when jobDesignation or experience range changes (with 1 second debounce)
  useEffect(() => {
    if (!jobDesignation.trim()) {
      setTopicCards([]);
      return;
    }

    // Only fetch if we're in edit mode or haven't visited configure station yet
    if (!isEditMode && hasVisitedConfigureStation) {
      return;
    }

    const timeoutId = setTimeout(async () => {
      setLoadingCards(true);
      setError(null);

      try {
        const response = await axios.post("/api/assessments/generate-topic-cards", {
          jobDesignation: jobDesignation.trim(),
          experienceMin: experienceMin,
          experienceMax: experienceMax,
        });

        if (response.data?.success) {
          setTopicCards(response.data.data.cards || []);
        } else {
          setError("Failed to generate topic cards");
        }
      } catch (err: any) {
        console.error("Error generating topic cards:", err);
        setError(err.response?.data?.message || err.message || "Failed to generate topic cards");
      } finally {
        setLoadingCards(false);
      }
    }, 1000);

    return () => clearTimeout(timeoutId);
  }, [jobDesignation, experienceMin, experienceMax, isEditMode, hasVisitedConfigureStation]);

  const loadDraftAssessment = async (assessmentId: string) => {
    setLoadingDraft(true);
    setError(null);
    
    try {
      // Fetch assessment data
      const response = await axios.get(`/api/assessments/get-questions?assessmentId=${assessmentId}`);
      
      if (response.data?.success && response.data?.data) {
        const assessmentData = response.data.data;
        // The backend returns assessment in assessmentData.assessment, but also check if it's directly in assessmentData
        const assessment = assessmentData.assessment || assessmentData;
        
        // Debug logging
        console.log("Loading draft assessment:", {
          assessmentId,
          hasAssessment: !!assessment,
          topicsCount: assessment?.topics?.length || 0,
          topics: assessment?.topics,
          assessmentDataKeys: Object.keys(assessmentData),
          fullAssessment: assessment,
        });
        
        // Set assessment ID
        setAssessmentId(assessmentId);
        
        // Load Station 1 data
        if (assessment.jobDesignation) {
          setJobDesignation(assessment.jobDesignation);
        }
        if (assessment.selectedSkills) {
          setSelectedSkills(assessment.selectedSkills);
        }
        if (assessment.experienceMin !== undefined) {
          setExperienceMin(assessment.experienceMin);
        }
        if (assessment.experienceMax !== undefined) {
          setExperienceMax(assessment.experienceMax);
        }
        if (assessment.availableQuestionTypes) {
          setAvailableQuestionTypes(assessment.availableQuestionTypes);
        }
        
        // Regenerate topic cards for draft (to show Related Technologies & Skills)
        if (assessment.jobDesignation && assessment.jobDesignation.trim()) {
          try {
            setLoadingCards(true);
            const topicCardsResponse = await axios.post("/api/assessments/generate-topic-cards", {
              jobDesignation: assessment.jobDesignation.trim(),
              experienceMin: assessment.experienceMin !== undefined ? assessment.experienceMin : 0,
              experienceMax: assessment.experienceMax !== undefined ? assessment.experienceMax : 10,
            });
            if (topicCardsResponse.data?.success) {
              setTopicCards(topicCardsResponse.data.data.cards || []);
            }
          } catch (err: any) {
            console.error("Error loading topic cards for draft:", err);
            // Don't show error, just continue loading
          } finally {
            setLoadingCards(false);
          }
        }
        
        // Load Station 2 data (topics configuration)
        // Check both assessment.topics and assessmentData.topics (backend might return topics separately)
        const topicsToLoad = assessment.topics || assessmentData.topics || [];
        console.log("Topics to load:", {
          fromAssessment: assessment.topics?.length || 0,
          fromAssessmentData: assessmentData.topics?.length || 0,
          topicsToLoad: topicsToLoad.length,
          topics: topicsToLoad,
        });
        
        if (topicsToLoad && topicsToLoad.length > 0) {
          const isAptitude = assessment.isAptitudeAssessment || false;
          setTopics(topicsToLoad.map((t: any) => t.topic || t));
          
          const configs = topicsToLoad.map((t: any) => {
            const isTopicAptitude = t.isAptitude === true || (isAptitude && t.category === "aptitude");
            
            // Load question type configs from questionConfigs if available
            let questionTypeConfigs: QuestionTypeConfig[] = [];
            
            if (t.questionConfigs && t.questionConfigs.length > 0) {
              // Group by question type and difficulty
              const configMap: { [key: string]: QuestionTypeConfig } = {};
              for (const qc of t.questionConfigs) {
                // Handle both plain objects and MongoDB documents
                const qcType = (typeof qc === 'object' && qc !== null) ? (qc.type || (qc as any).get?.("type")) : null;
                const qcDifficulty = (typeof qc === 'object' && qc !== null) ? (qc.difficulty || (qc as any).get?.("difficulty")) : null;
                const qcLanguage = (typeof qc === 'object' && qc !== null) ? (qc.language || (qc as any).get?.("language")) : undefined;
                const qcJudge0 = (typeof qc === 'object' && qc !== null) ? 
                  (qc.judge0_enabled !== undefined ? qc.judge0_enabled : ((qc as any).get?.("judge0_enabled") !== undefined ? (qc as any).get("judge0_enabled") : undefined)) : 
                  undefined;
                
                const type = qcType || "MCQ";
                const difficulty = qcDifficulty || "Medium";
                const key = `${type}_${difficulty}`;
                
                if (!configMap[key]) {
                  configMap[key] = {
                    questionType: type,
                    difficulty: difficulty,
                    numQuestions: 0,
                    language: qcLanguage,
                    judge0_enabled: qcJudge0,
                  };
                }
                configMap[key].numQuestions++;
              }
              questionTypeConfigs = Object.values(configMap);
            } else if (t.questionTypes && t.questionTypes.length > 0) {
              // Fallback: create configs from questionTypes array
              questionTypeConfigs = t.questionTypes.map((qt: string) => ({
                questionType: qt,
                difficulty: t.difficulty || "Medium",
                numQuestions: Math.floor((t.numQuestions || 1) / t.questionTypes.length) || 1,
                language: qt === "coding" ? (t.language || getLanguageFromTopic(t.topic)) : undefined,
                judge0_enabled: qt === "coding" ? (t.judge0_enabled !== undefined ? t.judge0_enabled : true) : undefined,
              }));
            } else {
              // Default: single question type
              const questionType = availableQuestionTypes[0] || QUESTION_TYPES[0];
              questionTypeConfigs = [{
                questionType: questionType,
                difficulty: t.difficulty || "Medium",
                numQuestions: t.numQuestions || 1,
                language: questionType === "coding" ? (t.language || getLanguageFromTopic(t.topic)) : undefined,
                judge0_enabled: questionType === "coding" ? (t.judge0_enabled !== undefined ? t.judge0_enabled : true) : undefined,
              }];
            }
            
            if (isTopicAptitude) {
              const availableSubTopics = t.availableSubTopics || t.subTopics || [];
              const defaultSubTopic = availableSubTopics.length > 0 ? availableSubTopics[0] : undefined;
              const selectedSubTopic = t.subTopic || defaultSubTopic;
              
              return {
                topic: t.topic,
                questionTypeConfigs: questionTypeConfigs,
                isAptitude: true,
                subTopic: selectedSubTopic,
                aptitudeStructure: t.aptitudeStructure || undefined,
                availableSubTopics: availableSubTopics,
              };
            } else {
              return {
                topic: t.topic,
                questionTypeConfigs: questionTypeConfigs,
                isAptitude: false,
                coding_supported: t.coding_supported !== undefined ? t.coding_supported : undefined,
              };
            }
          });
          
          setTopicConfigs(configs);
          originalTopicConfigsRef.current = JSON.parse(JSON.stringify(configs));
          setHasVisitedConfigureStation(true);
          
          // Debug logging
          console.log("Topic configs loaded:", {
            configsCount: configs.length,
            configs: configs,
          });
        } else {
          // Debug logging if no topics found
          console.log("No topics found in assessment:", {
            assessmentId,
            hasTopics: !!assessment.topics,
            topicsLength: assessment.topics?.length || 0,
            hasTopicsInData: !!topicsToLoad,
            topicsToLoadLength: topicsToLoad?.length || 0,
            assessmentKeys: Object.keys(assessment),
            assessmentDataKeys: Object.keys(assessmentData),
          });
        }
        
        // Load Station 3 data (questions)
        if (assessmentData.questions && assessmentData.questions.length > 0) {
          setQuestions(assessmentData.questions);
          setHasVisitedReviewStation(true);
          
          // Load question type times if available
          if (assessment.questionTypeTimes) {
            setQuestionTypeTimes(assessment.questionTypeTimes);
          }
          if (assessment.enablePerSectionTimers !== undefined) {
            setEnablePerSectionTimers(assessment.enablePerSectionTimers);
          }
        }
        
        // Load Station 4 data (schedule)
        if (assessment.schedule) {
          const schedule = assessment.schedule;
          if (schedule.startTime) {
            // Convert ISO string to datetime-local format
            const startDate = new Date(schedule.startTime);
            const startLocal = new Date(startDate.getTime() - startDate.getTimezoneOffset() * 60000)
              .toISOString()
              .slice(0, 16);
            setStartTime(startLocal);
          }
          if (schedule.endTime) {
            const endDate = new Date(schedule.endTime);
            const endLocal = new Date(endDate.getTime() - endDate.getTimezoneOffset() * 60000)
              .toISOString()
              .slice(0, 16);
            setEndTime(endLocal);
          }
        }
        
        // Load Station 5 data (candidates and URL)
        if (assessment.candidates && assessment.candidates.length > 0) {
          setCandidates(assessment.candidates);
        }
        if (assessment.assessmentUrl) {
          setAssessmentUrl(assessment.assessmentUrl);
        }
        
        // Load finalization data (always load, even if empty/placeholder)
        setFinalTitle(assessment.title || "");
        setFinalDescription(assessment.description || "");
        if (assessment.passPercentage !== undefined) {
          setPassPercentage(assessment.passPercentage);
        }
        
        // Load preview questions if available
        if (assessment.previewQuestions && Array.isArray(assessment.previewQuestions) && assessment.previewQuestions.length > 0) {
          console.log(`[Preview] Loading ${assessment.previewQuestions.length} preview questions from draft`);
          setPreviewQuestions(assessment.previewQuestions);
          setCurrentPreviewIndex(0);
          
          // Also convert preview questions to questions for review page if questions don't exist
          if (!assessmentData.questions || assessmentData.questions.length === 0) {
            console.log(`[Preview] Converting ${assessment.previewQuestions.length} preview questions to questions for review page`);
            setQuestions(assessment.previewQuestions);
          }
        } else {
          console.log("[Preview] No preview questions in draft:", {
            hasPreviewQuestions: !!assessment.previewQuestions,
            isArray: Array.isArray(assessment.previewQuestions),
            length: assessment.previewQuestions?.length || 0,
          });
        }
        
        // Store assessment ID in localStorage for draft recovery
        try {
          localStorage.setItem('currentDraftAssessmentId', assessmentId);
        } catch (err) {
          console.error("Error saving draft ID to localStorage:", err);
        }
        
        // Determine which station to show based on what's been completed
        if (assessment.status === "ready" || assessment.status === "scheduled") {
          setCurrentStation(5); // Show candidates station if finalized
          // Clear draft from localStorage since assessment is finalized
          try {
            localStorage.removeItem('currentDraftAssessmentId');
          } catch (err) {
            console.error("Error clearing draft ID from localStorage:", err);
          }
        } else if (assessment.candidates && assessment.candidates.length > 0) {
          setCurrentStation(5);
        } else if (assessment.schedule) {
          setCurrentStation(4);
        } else if (assessmentData.questions && assessmentData.questions.length > 0) {
          setCurrentStation(3);
        } else if (assessment.topics && assessment.topics.length > 0) {
          setCurrentStation(2);
        } else {
          setCurrentStation(1);
        }
      }
    } catch (err: any) {
      console.error("Error loading draft assessment:", err);
      
      // If assessment not found (404), clear the invalid ID from localStorage and continue with new assessment
      if (err.response?.status === 404 || err.response?.status === 400) {
        console.log("Assessment not found, clearing invalid draft ID from localStorage");
        try {
          localStorage.removeItem('currentDraftAssessmentId');
        } catch (localErr) {
          console.error("Error clearing draft ID from localStorage:", localErr);
        }
        // Don't show error to user - just silently continue with new assessment
        setError(null);
      } else {
        // For other errors, show the error message
        setError(err.response?.data?.message || err.message || "Failed to load draft assessment");
      }
    } finally {
      setLoadingDraft(false);
    }
  };

  const handleGenerateTopicCards = async () => {
    if (!jobDesignation.trim()) {
      setError("Please enter a job designation");
      return;
    }

    setLoadingCards(true);
    setError(null);

    try {
      const response = await axios.post("/api/assessments/generate-topic-cards", {
        jobDesignation: jobDesignation.trim(),
      });

      if (response.data?.success) {
        setTopicCards(response.data.data.cards || []);
      } else {
        setError("Failed to generate topic cards");
      }
    } catch (err: any) {
      console.error("Error generating topic cards:", err);
      setError(err.response?.data?.message || err.message || "Failed to generate topic cards");
    } finally {
      setLoadingCards(false);
    }
  };

  const handleCardClick = (card: string) => {
    if (!selectedSkills.includes(card)) {
      setSelectedSkills([...selectedSkills, card]);
    }
  };

  const handleAddManualSkill = () => {
    if (manualSkillInput.trim() && !selectedSkills.includes(manualSkillInput.trim())) {
      setSelectedSkills([...selectedSkills, manualSkillInput.trim()]);
      setManualSkillInput("");
    }
  };

  const handleRemoveSkill = (skillToRemove: string) => {
    setSelectedSkills(selectedSkills.filter((s) => s !== skillToRemove));
  };

  const handleGenerateTopics = async () => {
    if (selectedSkills.length === 0) {
      setError("Please select at least one skill to assess");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // If editing and assessment already exists, skip creation and just update topics
      if (isEditMode && assessmentId) {
        // For editing, we'll update the existing assessment's topics
        // First, get the current assessment to preserve other data
        const assessmentResponse = await axios.get(`/api/assessments/get-questions?assessmentId=${assessmentId}`);
        if (assessmentResponse.data?.success) {
          // Update job designation and skills in the assessment
          // Then regenerate topics using the same endpoint but it will update existing
          const response = await axios.post("/api/assessments/create-from-job-designation", {
            jobDesignation: jobDesignation.trim(),
            selectedSkills: selectedSkills,
            experienceMin: experienceMin.toString(),
            experienceMax: experienceMax.toString(),
          });
          
          // If a new assessment was created, use its ID; otherwise keep the existing one
          if (response.data?.success) {
            const data = response.data.data;
            const newAssessmentId = data.assessment._id || data.assessment.id;
            // Only update if we got a different ID (shouldn't happen, but safety check)
            if (newAssessmentId !== assessmentId) {
              setAssessmentId(newAssessmentId);
            }
            
            const isAptitude = data.assessment?.isAptitudeAssessment || false;
            setTopics(data.assessment.topics.map((t: any) => t.topic));
            setAvailableQuestionTypes(data.questionTypes || QUESTION_TYPES);
            
            setTopicConfigs(
              data.assessment.topics.map((t: any) => {
                const isTopicAptitude = t.isAptitude === true || (isAptitude && t.category === "aptitude");
                
                if (isTopicAptitude) {
                  const availableSubTopics = t.availableSubTopics || t.subTopics || [];
                  const defaultSubTopic = availableSubTopics.length > 0 ? availableSubTopics[0] : undefined;
                  const selectedSubTopic = t.subTopic || defaultSubTopic;
                  
                  let defaultQuestionType = "MCQ";
                  if (selectedSubTopic && t.aptitudeStructure?.subTopics?.[selectedSubTopic]) {
                    const questionTypes = t.aptitudeStructure.subTopics[selectedSubTopic];
                    defaultQuestionType = questionTypes.length > 0 ? questionTypes[0] : "MCQ";
                  }
                  
                  return {
                    topic: t.topic,
                    questionTypeConfigs: [{
                    questionType: defaultQuestionType,
                    difficulty: t.difficulty || "Medium",
                    numQuestions: 1,
                    }],
                    isAptitude: true,
                    subTopic: selectedSubTopic,
                    aptitudeStructure: t.aptitudeStructure || undefined,
                    availableSubTopics: availableSubTopics,
                  };
                } else {
                  // Handle technical topic
                  const questionType = t.questionTypes?.[0] || data.questionTypes?.[0] || QUESTION_TYPES[0];
                  const isCoding = questionType === "coding";
                  // Auto-detect language for coding questions
                  const autoLanguage = isCoding ? getLanguageFromTopic(t.topic) : undefined;
                  
                  return {
                    topic: t.topic,
                questionTypeConfigs: [{
                  questionType: questionType,
                    difficulty: t.difficulty || "Medium",
                    numQuestions: 1,
                  language: autoLanguage,
                  judge0_enabled: isCoding ? true : undefined,
                }],
                    isAptitude: false,
                coding_supported: t.coding_supported !== undefined ? t.coding_supported : (isCoding ? true : undefined),
                  };
                }
              })
            );
          }
        }
        setLoading(false);
        return;
      }
      
      // Check if we already have an assessmentId - if so, don't create a new one
      // Also check localStorage as a fallback
      let currentAssessmentId = assessmentId;
      if (!currentAssessmentId) {
        try {
          const savedDraftId = localStorage.getItem('currentDraftAssessmentId');
          if (savedDraftId && savedDraftId.trim()) {
            currentAssessmentId = savedDraftId;
            setAssessmentId(savedDraftId);
          }
        } catch (err) {
          console.error("Error reading draft ID from localStorage:", err);
        }
      }
      
      let response;
      
      if (!currentAssessmentId) {
        // Create new assessment only if we don't have one
        response = await axios.post("/api/assessments/create-from-job-designation", {
          jobDesignation: jobDesignation.trim(),
          selectedSkills: selectedSkills,
          experienceMin: experienceMin.toString(),
          experienceMax: experienceMax.toString(),
        });
      } else {
        // We already have an assessment - just regenerate topics and update it
        // Generate topics first
        const topicsResponse = await axios.post("/api/assessments/generate-topics-from-skill", {
          skill: selectedSkills.join(", "),
          experienceMin: experienceMin.toString(),
          experienceMax: experienceMax.toString(),
        });
        
        if (topicsResponse.data?.success) {
          const generatedTopics = topicsResponse.data.data.topics || [];
          
          // Build topic configs from generated topics
          const topicConfigsToUpdate = generatedTopics.map((t: string) => ({
            topic: t,
            questionTypeConfigs: [{
              questionType: "MCQ", // Default, will be determined by backend
              difficulty: "Medium",
              numQuestions: 1,
            }],
            isAptitude: false,
          }));
          
          // Update the existing assessment with new topics
          await axios.put("/api/assessments/update-draft", {
            assessmentId: currentAssessmentId,
            jobDesignation: jobDesignation.trim(),
            selectedSkills: selectedSkills,
            experienceMin: experienceMin,
            experienceMax: experienceMax,
            topics: topicConfigsToUpdate,
          });
          
          // Fetch the updated assessment to get the full data
          const assessmentResponse = await axios.get(`/api/assessments/get-questions?assessmentId=${currentAssessmentId}`);
          if (assessmentResponse.data?.success) {
            const assessmentData = assessmentResponse.data.data.assessment;
            response = {
              data: {
                success: true,
                data: {
                  assessment: assessmentData,
                  questionTypes: assessmentData.availableQuestionTypes || QUESTION_TYPES,
                }
              }
            };
          } else {
            setError("Failed to load updated assessment");
            setLoading(false);
            return;
          }
        } else {
          setError("Failed to generate topics");
          setLoading(false);
          return;
        }
      }

      if (response.data?.success) {
        const data = response.data.data;
        const isAptitude = data.assessment?.isAptitudeAssessment || false;
        setTopics(data.assessment.topics.map((t: any) => t.topic));
        setAvailableQuestionTypes(data.questionTypes || QUESTION_TYPES);
        const newAssessmentId = data.assessment._id || data.assessment.id;
        // Only update assessmentId if it changed (new assessment created)
        if (!currentAssessmentId || newAssessmentId !== currentAssessmentId) {
          setAssessmentId(newAssessmentId);
          currentAssessmentId = newAssessmentId;
        }
        
        const configs = data.assessment.topics.map((t: any) => {
            // Check if this specific topic is an aptitude topic
            const isTopicAptitude = t.isAptitude === true || (isAptitude && t.category === "aptitude");
            
            if (isTopicAptitude) {
              // Handle aptitude topic
              const availableSubTopics = t.availableSubTopics || t.subTopics || [];
              const defaultSubTopic = availableSubTopics.length > 0 ? availableSubTopics[0] : undefined;
              const selectedSubTopic = t.subTopic || defaultSubTopic;
              
              // Get question type based on selected sub-topic
              let defaultQuestionType = "MCQ"; // Default for aptitude
              if (selectedSubTopic && t.aptitudeStructure?.subTopics?.[selectedSubTopic]) {
                const questionTypes = t.aptitudeStructure.subTopics[selectedSubTopic];
                defaultQuestionType = questionTypes.length > 0 ? questionTypes[0] : "MCQ";
              }
              
              return {
                topic: t.topic,
              questionTypeConfigs: [{
                questionType: defaultQuestionType,
                difficulty: t.difficulty || "Medium",
                numQuestions: 1,
              }],
                isAptitude: true,
                subTopic: selectedSubTopic,
                aptitudeStructure: t.aptitudeStructure || undefined,
                availableSubTopics: availableSubTopics,
              };
            } else {
              // Handle technical topic
            const questionType = t.questionTypes?.[0] || data.questionTypes?.[0] || QUESTION_TYPES[0];
            const isCoding = questionType === "coding";
            // Auto-detect language for coding questions
            const autoLanguage = isCoding ? getLanguageFromTopic(t.topic) : undefined;
            
              return {
                topic: t.topic,
              questionTypeConfigs: [{
                questionType: questionType,
                difficulty: t.difficulty || "Medium",
                numQuestions: 1,
                language: autoLanguage,
                judge0_enabled: isCoding ? true : undefined,
              }],
                isAptitude: false,
              coding_supported: t.coding_supported !== undefined ? t.coding_supported : (isCoding ? true : undefined),
            };
          }
        });
        
        setTopicConfigs(configs);
        originalTopicConfigsRef.current = JSON.parse(JSON.stringify(configs));
        setHasVisitedConfigureStation(true);
        
        // Store assessment ID in localStorage for draft recovery
        try {
          if (currentAssessmentId) {
            localStorage.setItem('currentDraftAssessmentId', currentAssessmentId);
          }
        } catch (err) {
          console.error("Error saving draft ID to localStorage:", err);
        }
        
        // Immediately save topic configs and all other data to draft
        // Use the title from the assessment if available, otherwise use finalTitle or generate one
        const assessmentTitle = data.assessment?.title || finalTitle || `Assessment for ${jobDesignation.trim()}`;
        const assessmentDescription = data.assessment?.description || finalDescription || "";
        
        try {
          if (currentAssessmentId) {
            await axios.put("/api/assessments/update-draft", {
              assessmentId: currentAssessmentId,
              title: assessmentTitle,
              description: assessmentDescription,
              jobDesignation: jobDesignation.trim(),
              selectedSkills: selectedSkills,
              experienceMin: experienceMin,
              experienceMax: experienceMax,
              topics: configs,
            });
            
            // Update local state with the title from assessment
            if (data.assessment?.title && !finalTitle) {
              setFinalTitle(assessmentTitle);
            }
            if (data.assessment?.description && !finalDescription) {
              setFinalDescription(assessmentDescription);
            }
          }
        } catch (err: any) {
          console.error("Error saving topics to draft:", err);
          // Don't show error to user, just log it
        }
      } else {
        setError("Failed to generate topics");
      }
    } catch (err: any) {
      console.error("Error generating topics:", err);
      setError(err.response?.data?.message || err.message || "Failed to generate topics");
    } finally {
      setLoading(false);
    }
  };

  const handleAddQuestionType = (topicIndex: number) => {
    const updated = [...topicConfigs];
    const topic = updated[topicIndex];
    const isAptitude = topic.isAptitude || false;
    
    // Get available question types
    let availableTypes = QUESTION_TYPES;
    if (isAptitude && topic.subTopic && topic.aptitudeStructure) {
      availableTypes = topic.aptitudeStructure.subTopics[topic.subTopic] || [];
    }
    
    // Find a question type that's not already used
    const usedTypes = topic.questionTypeConfigs.map(qtc => qtc.questionType);
    const newType = availableTypes.find(type => !usedTypes.includes(type)) || availableTypes[0] || "MCQ";
    
    // Create new question type config
    const newConfig: QuestionTypeConfig = {
      questionType: newType,
      difficulty: "Medium",
      numQuestions: 1,
    };
    
    // Auto-set language if coding
    if (newType === "coding") {
      newConfig.language = getLanguageFromTopic(topic.topic);
      newConfig.judge0_enabled = true;
    }
    
    topic.questionTypeConfigs.push(newConfig);
    setTopicConfigs(updated);
  };

  const handleRemoveQuestionType = (topicIndex: number, configIndex: number) => {
    const updated = [...topicConfigs];
    const topic = updated[topicIndex];
    
    // Don't allow removing the last question type
    if (topic.questionTypeConfigs.length <= 1) {
      setError("Each topic must have at least one question type");
      return;
    }
    
    topic.questionTypeConfigs.splice(configIndex, 1);
    setTopicConfigs(updated);
  };

  const handleUpdateQuestionTypeConfig = (
    topicIndex: number,
    configIndex: number,
    field: keyof QuestionTypeConfig,
    value: any
  ) => {
    const updated = [...topicConfigs];
    const topic = updated[topicIndex];
    const config = topic.questionTypeConfigs[configIndex];
    
    // Update the field
    (config as any)[field] = value;
    
    // Auto-set language when question type changes to "coding"
    if (field === "questionType") {
      if (value === "coding") {
        // Only allow "coding" if topic supports coding
        const topicObj = topicConfigs[topicIndex];
        if (topicObj && topicObj.coding_supported === false) {
          // Topic doesn't support coding, revert to previous value or use a safe default
          const previousValue = config.questionType;
          (config as any).questionType = previousValue || "Subjective";
          return; // Don't update if coding is not supported
        }
        config.language = getLanguageFromTopic(topic.topic);
        config.judge0_enabled = true;
      } else {
        config.language = undefined;
        config.judge0_enabled = undefined;
      }
    }
    
    setTopicConfigs(updated);
  };

  const handleUpdateTopicConfig = (index: number, field: keyof Topic, value: any) => {
    const updated = [...topicConfigs];
    updated[index] = { ...updated[index], [field]: value };
    
    // For aptitude topics: when sub-topic changes, update available question types
    if (field === "subTopic" && updated[index].isAptitude && updated[index].aptitudeStructure) {
      const subTopic = value;
      const questionTypes = updated[index].aptitudeStructure?.subTopics[subTopic] || [];
      // Update all question type configs to use available types
      if (questionTypes.length > 0) {
        updated[index].questionTypeConfigs.forEach((qtc, idx) => {
          if (!questionTypes.includes(qtc.questionType)) {
            qtc.questionType = questionTypes[0];
          }
        });
      }
    }
    
    // When topic name changes, update language for coding questions
    if (field === "topic") {
      updated[index].questionTypeConfigs.forEach(qtc => {
        if (qtc.questionType === "coding" && !qtc.language) {
          qtc.language = getLanguageFromTopic(value);
          qtc.judge0_enabled = true;
        }
      });
    }
    
    setTopicConfigs(updated);
  };

  // Helper function to get question types for a given aptitude topic and sub-topic
  const getAptitudeQuestionTypes = (config: Topic): string[] => {
    if (!config.isAptitude || !config.aptitudeStructure || !config.subTopic) {
      return availableQuestionTypes;
    }
    return config.aptitudeStructure.subTopics[config.subTopic] || [];
  };


  // Auto-detect language from topic/skill name
  const getLanguageFromTopic = (topic: string): string => {
    if (!topic) return "71"; // Default to Python
    
    const topicLower = topic.toLowerCase();
    
    // Language-specific keywords
    const languageMap: { [key: string]: string } = {
      // Python
      "python": "71",
      "django": "71",
      "flask": "71",
      "pandas": "71",
      "numpy": "71",
      "tensorflow": "71",
      "pytorch": "71",
      "scikit": "71",
      "jupyter": "71",
      
      // JavaScript/TypeScript
      "javascript": "63",
      "js": "63",
      "node": "63",
      "nodejs": "63",
      "react": "63",
      "vue": "63",
      "angular": "63",
      "express": "63",
      "typescript": "74",
      "ts": "74",
      "next": "63",
      "nextjs": "63",
      
      // Java
      "java": "62",
      "spring": "62",
      "hibernate": "62",
      "maven": "62",
      "gradle": "62",
      
      // C/C++
      "c++": "54",
      "cpp": "54",
      "cplusplus": "54",
      "c": "50",
      
      // C#
      "c#": "51",
      "csharp": "51",
      ".net": "51",
      "dotnet": "51",
      "asp.net": "51",
      
      // Go
      "go": "60",
      "golang": "60",
      
      // Rust
      "rust": "73",
      
      // Kotlin
      "kotlin": "78",
      "android": "78",
      
      // PHP
      "php": "68",
      "laravel": "68",
      "symfony": "68",
      
      // Ruby
      "ruby": "72",
      "rails": "72",
      "ruby on rails": "72",
      
      // Swift
      "swift": "83",
      "ios": "83",
      
      // SQL
      "sql": "82",
      "mysql": "82",
      "postgresql": "82",
      "mongodb": "82",
      "database": "82",
    };
    
    // Check for exact matches first
    for (const [keyword, langId] of Object.entries(languageMap)) {
      if (topicLower.includes(keyword)) {
        return langId;
      }
    }
    
    // Default to Python for general programming topics
    return "71";
  };

  const handleRemoveTopic = async (index: number) => {
    const topicToRemove = topicConfigs[index];
    if (!topicToRemove) return;

    // Remove from local state first
    const updatedConfigs = topicConfigs.filter((_, i) => i !== index);
    setTopicConfigs(updatedConfigs);

    // If assessmentId exists, also remove from database
    if (assessmentId && topicToRemove.topic) {
      try {
        await axios.delete("/api/assessments/remove-topic", {
          data: {
            assessmentId: assessmentId,
            topicsToRemove: [topicToRemove.topic],
          },
        });
        // Also update topics list
        setTopics(topics.filter(t => t !== topicToRemove.topic));
      } catch (err: any) {
        console.error("Error removing topic from database:", err);
        // Revert local state change if database update fails
        setTopicConfigs(topicConfigs);
        setError(err.response?.data?.message || "Failed to remove topic from database");
      }
    } else {
      // If no assessmentId, just update local topics list
      setTopics(topics.filter(t => t !== topicToRemove.topic));
    }
  };

  const handleAddCustomTopic = async () => {
    if (!customTopicInput.trim()) {
      setError("Please enter a topic name");
      return;
    }

    const topicName = customTopicInput.trim();
    
    // Check if topic already exists
    if (topicConfigs.some(t => t.topic.toLowerCase() === topicName.toLowerCase())) {
      setError("Topic already exists");
      return;
    }

    setError(null);
    setLoading(true);

    try {
      // Regenerate topic details from backend
      const response = await axios.post("/api/assessments/regenerate-single-topic", {
        topic: topicName,
      });

      if (response.data?.success) {
        const data = response.data.data;
        const questionType = data.questionType || "MCQ";
        const isCoding = questionType === "coding";
        const autoLanguage = isCoding ? getLanguageFromTopic(topicName) : undefined;

        const newTopic: Topic = {
          topic: topicName,
          questionTypeConfigs: [{
            questionType: questionType,
            difficulty: "Medium",
            numQuestions: 1,
            language: autoLanguage,
            judge0_enabled: isCoding ? true : undefined,
          }],
          isAptitude: false,
          coding_supported: data.coding_supported !== undefined ? data.coding_supported : (isCoding ? true : undefined),
        };

        setTopicConfigs([...topicConfigs, newTopic]);
        setCustomTopicInput("");
      } else {
        setError("Failed to add custom topic");
      }
    } catch (err: any) {
      console.error("Error adding custom topic:", err);
      setError(err.response?.data?.message || err.message || "Failed to add custom topic");
    } finally {
      setLoading(false);
    }
  };

  const handleResetTopics = () => {
    if (originalTopicConfigsRef.current.length > 0) {
      setTopicConfigs(JSON.parse(JSON.stringify(originalTopicConfigsRef.current)));
      setError(null);
    }
  };

  const handleRegenerateAllTopics = async () => {
    if (!assessmentId) {
      setError("Assessment ID not found. Please generate topics first.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // First, ensure we have skills - fetch from assessment if not in state
      let skillsToUse = selectedSkills;
      if (!skillsToUse || skillsToUse.length === 0) {
        try {
          const assessmentResponse = await axios.get(`/api/assessments/get-questions?assessmentId=${assessmentId}`);
          if (assessmentResponse.data?.success) {
            const assessment = assessmentResponse.data.data.assessment || assessmentResponse.data.data;
            if (assessment.selectedSkills && assessment.selectedSkills.length > 0) {
              skillsToUse = assessment.selectedSkills;
              setSelectedSkills(assessment.selectedSkills); // Update state for future use
            }
          }
        } catch (err) {
          console.error("Error fetching assessment skills:", err);
        }
      }
      
      if (!skillsToUse || skillsToUse.length === 0) {
        setError("No skills found in assessment. Please go back to Station 1 and select skills first.");
        setLoading(false);
        return;
      }

      // First, delete all questions from all topics
      await axios.post("/api/assessments/delete-topic-questions", {
        assessmentId: assessmentId,
        // No topic specified = delete all
      });
      
      // Clear questions state
      setQuestions([]);
      setPreviewQuestions([]);
      
      // Then regenerate topics - this will create entirely new topics
      // The handleGenerateTopics function will handle updating the existing assessment
      // by calling create-from-job-designation which will replace all topics
      await handleGenerateTopics();
    } catch (err: any) {
      console.error("Error regenerating topics:", err);
      setError(err.response?.data?.message || err.message || "Failed to regenerate topics");
    } finally {
      setLoading(false);
    }
  };

  const handleRegenerateSingleTopic = async (topicIndex: number) => {
    const topic = topicConfigs[topicIndex];
    if (!topic || topic.isAptitude) {
      return; // Don't regenerate aptitude topics
    }

    if (!assessmentId) {
      setError("Assessment ID not found. Please generate topics first.");
      return;
    }

    setRegeneratingTopicIndex(topicIndex);
    setError(null);

    try {
      // First, ensure we have skills - always fetch from assessment to ensure we have the latest
      let skillsToUse = selectedSkills;
      
      // Always try to fetch from assessment to ensure we have the latest skills
      try {
        const assessmentResponse = await axios.get(`/api/assessments/get-questions?assessmentId=${assessmentId}`);
        if (assessmentResponse.data?.success) {
          const assessment = assessmentResponse.data.data.assessment || assessmentResponse.data.data;
          if (assessment.selectedSkills && assessment.selectedSkills.length > 0) {
            skillsToUse = assessment.selectedSkills;
            setSelectedSkills(assessment.selectedSkills); // Update state for future use
          }
        }
      } catch (err) {
        console.error("Error fetching assessment skills:", err);
        // If fetch fails, try to use skills from state
        if (!skillsToUse || skillsToUse.length === 0) {
          setError("Failed to fetch skills from assessment. Please go back to Station 1 and ensure skills are selected.");
          setRegeneratingTopicIndex(null);
          return;
        }
      }
      
      if (!skillsToUse || skillsToUse.length === 0) {
        setError("No skills found in assessment. Please go back to Station 1 and select skills first.");
        setRegeneratingTopicIndex(null);
        return;
      }
      
      console.log("Using skills for topic regeneration:", skillsToUse);

      // First, delete questions for this specific topic
      await axios.post("/api/assessments/delete-topic-questions", {
        assessmentId: assessmentId,
        topic: topic.topic,
      });
      
      // Clear preview questions for this topic (they're no longer valid after regeneration)
      setPreviewQuestions((prev) => {
        const filtered = prev.filter((q: any) => q.topic !== topic.topic);
        console.log(`[Preview] Cleared preview questions for topic '${topic.topic}'. Remaining: ${filtered.length}`);
        return filtered;
      });

      // Then regenerate the topic (get new question type and coding support)
      const response = await axios.post("/api/assessments/regenerate-single-topic", {
        topic: topic.topic,
        assessmentId: assessmentId,
      });

      if (response.data?.success) {
        const data = response.data.data;
        const newTopicName = data.topic || topic.topic; // Use new topic name if provided
        const questionType = data.questionType || "MCQ";
        const isCoding = questionType === "coding";
        const autoLanguage = isCoding ? getLanguageFromTopic(newTopicName) : undefined; // Use new topic name for language detection

        const updated = [...topicConfigs];
        updated[topicIndex] = {
          ...updated[topicIndex],
          topic: newTopicName, // Update topic name
          coding_supported: data.coding_supported !== undefined ? data.coding_supported : (isCoding ? true : undefined),
        };

        // Update the first question type config
        if (updated[topicIndex].questionTypeConfigs.length > 0) {
          updated[topicIndex].questionTypeConfigs[0] = {
            ...updated[topicIndex].questionTypeConfigs[0],
            questionType: questionType,
            language: autoLanguage,
            judge0_enabled: isCoding ? true : undefined,
          };
        } else {
          updated[topicIndex].questionTypeConfigs = [{
            questionType: questionType,
            difficulty: "Medium",
            numQuestions: 1,
            language: autoLanguage,
            judge0_enabled: isCoding ? true : undefined,
          }];
        }

        setTopicConfigs(updated);

        // CRITICAL: Reset regenerating state immediately after topic regeneration succeeds
        // Question generation will happen in background but button should show normal state
        setRegeneratingTopicIndex(null);

        // Generate questions only for this regenerated topic (in background)
        const topicConfig = updated[topicIndex];
        
        // Ensure we have valid question type configs
        if (!topicConfig.questionTypeConfigs || topicConfig.questionTypeConfigs.length === 0) {
          setError("No question type configuration found for this topic");
          return;
        }
        
        const flattenedTopic = topicConfig.questionTypeConfigs
          .filter((qtc) => qtc.numQuestions > 0) // Only include configs with questions
          .map((qtc) => ({
            topic: topicConfig.topic,
            questionType: qtc.questionType || "MCQ",
            difficulty: qtc.difficulty || "Medium",
            numQuestions: qtc.numQuestions || 1,
            isAptitude: topicConfig.isAptitude || false,
            subTopic: topicConfig.subTopic || undefined,
            language: qtc.language || undefined,
            judge0_enabled: qtc.judge0_enabled !== undefined ? qtc.judge0_enabled : undefined,
          }));

        // Only generate if we have valid topics with questions
        if (flattenedTopic.length === 0) {
          setError("No valid question configurations found for this topic");
          return;
        }

        // Use the skills we already fetched at the beginning
        // skillsToUse is already set from the beginning of the function

        // Generate questions for this topic only (async, don't block UI)
        try {
          const generateResponse = await axios.post("/api/assessments/generate-questions-from-config", {
            assessmentId,
            skill: skillsToUse.join(", "),
            topics: flattenedTopic,
          });

          if (generateResponse.data?.success) {
            // Update questions state - remove old questions for this topic and add new ones
            const newQuestions: any[] = [];
            generateResponse.data.data.topics.forEach((t: any) => {
              if (t.questions && t.questions.length > 0) {
                newQuestions.push(...t.questions);
              }
            });

            // Filter out old questions for both old and new topic names (in case topic name changed)
            const updatedQuestions = questions.filter((q: any) => q.topic !== topic.topic && q.topic !== newTopicName);
            setQuestions([...updatedQuestions, ...newQuestions]);
            
            // Also update previewQuestions - remove old and add new for this topic only
            setPreviewQuestions((prev) => {
              const filtered = prev.filter((q: any) => q.topic !== topic.topic && q.topic !== newTopicName);
              return [...filtered, ...newQuestions];
            });
            
            console.log(`[Topic Regeneration] Generated ${newQuestions.length} new questions for topic '${newTopicName}'. Removed old questions for '${topic.topic}'.`);
          }
        } catch (genErr: any) {
          // Log error but don't block - topic regeneration already succeeded
          console.error("Error generating questions after topic regeneration:", genErr);
          setError("Topic regenerated successfully, but failed to generate questions. You can generate questions later.");
        }
      } else {
        setError("Failed to regenerate topic");
      }
    } catch (err: any) {
      console.error("Error regenerating topic:", err);
      setError(err.response?.data?.message || err.message || "Failed to regenerate topic");
    } finally {
      setRegeneratingTopicIndex(null);
    }
  };

  const handleNextToStation2 = async () => {
    // If topics haven't been generated yet, generate them first
    if (topics.length === 0) {
      if (selectedSkills.length === 0) {
        setError("Please select at least one skill to assess");
        return;
      }
      
      setLoading(true);
      setError(null);

      try {
        const response = await axios.post("/api/assessments/create-from-job-designation", {
          jobDesignation: jobDesignation.trim(),
          selectedSkills: selectedSkills,
          experienceMin: experienceMin.toString(),
          experienceMax: experienceMax.toString(),
        });

        if (response.data?.success) {
          const data = response.data.data;
          const isAptitude = data.assessment?.isAptitudeAssessment || false;
          setTopics(data.assessment.topics.map((t: any) => t.topic));
          setAvailableQuestionTypes(data.questionTypes || QUESTION_TYPES);
          const newAssessmentId = data.assessment._id || data.assessment.id;
          setAssessmentId(newAssessmentId);
          
          // Note: Draft will be saved automatically when navigating away (browser back or Back to Dashboard button)
          
          const newTopicConfigs = data.assessment.topics.map((t: any) => {
            // Check if this specific topic is an aptitude topic
            const isTopicAptitude = t.isAptitude === true || (isAptitude && t.category === "aptitude");
            
            if (isTopicAptitude) {
              // Handle aptitude topic
              const availableSubTopics = t.availableSubTopics || t.subTopics || [];
              const defaultSubTopic = availableSubTopics.length > 0 ? availableSubTopics[0] : undefined;
              const selectedSubTopic = t.subTopic || defaultSubTopic;
              
              // Get question type based on selected sub-topic
              let defaultQuestionType = "MCQ"; // Default for aptitude
              if (selectedSubTopic && t.aptitudeStructure?.subTopics?.[selectedSubTopic]) {
                const questionTypes = t.aptitudeStructure.subTopics[selectedSubTopic];
                defaultQuestionType = questionTypes.length > 0 ? questionTypes[0] : "MCQ";
              }
              
              return {
                topic: t.topic,
                questionTypeConfigs: [{
                questionType: defaultQuestionType,
                difficulty: t.difficulty || "Medium",
                numQuestions: 1,
                }],
                isAptitude: true,
                subTopic: selectedSubTopic,
                aptitudeStructure: t.aptitudeStructure || undefined,
                availableSubTopics: availableSubTopics,
              };
            } else {
              // Handle technical topic - use topic-specific question type from backend
              // The backend now determines question type based on topic context
              const questionType = t.questionTypes?.[0] || "MCQ";
              const isCoding = questionType === "coding";
              const autoLanguage = isCoding ? getLanguageFromTopic(t.topic) : undefined;
              
              return {
                topic: t.topic,
                questionTypeConfigs: [{
                  questionType: questionType,
                difficulty: t.difficulty || "Medium",
                numQuestions: 1,
                  language: autoLanguage,
                  judge0_enabled: isCoding ? true : undefined,
                }],
                isAptitude: false,
                coding_supported: t.coding_supported !== undefined ? t.coding_supported : (isCoding ? true : undefined),
              };
            }
          });
          setTopicConfigs(newTopicConfigs);
          // After generating topics, navigate to Station 2
          setError(null);
          setHasVisitedConfigureStation(true);
          if (!hasVisitedReviewStation) {
            originalTopicConfigsRef.current = JSON.parse(JSON.stringify(newTopicConfigs));
          }
          setCurrentStation(2);
        } else {
          setError("Failed to generate topics");
        }
      } catch (err: any) {
        console.error("Error generating topics:", err);
        setError(err.response?.data?.message || err.message || "Failed to generate topics");
      } finally {
        setLoading(false);
      }
    } else {
      // Topics already generated, just navigate
      setError(null);
      setHasVisitedConfigureStation(true);
      if (!hasVisitedReviewStation) {
        originalTopicConfigsRef.current = JSON.parse(JSON.stringify(topicConfigs));
      }
      setCurrentStation(2);
    }
  };

  const handleNextToStation3 = async () => {
    if (topicConfigs.length === 0) {
      setError("Please configure at least one topic");
      return;
    }

    // Filter out topics with empty names
    const validConfigs = topicConfigs.filter((tc) => tc.topic.trim() !== "");
    if (validConfigs.length === 0) {
      setError("Please enter at least one topic name");
      return;
    }

    // Validate configurations - for aptitude topics, sub-topic is required
    // Each topic must have at least one valid question type config
    const invalidConfigs = validConfigs.filter(
      (tc) => {
        // Check if topic has at least one question type config
        if (!tc.questionTypeConfigs || tc.questionTypeConfigs.length === 0) {
          return true;
        }
        
        // Check if all question type configs are valid
        const invalidConfigs = tc.questionTypeConfigs.filter(
          (qtc) => !qtc.questionType || !qtc.difficulty || qtc.numQuestions < 1
        );
        if (invalidConfigs.length > 0) {
          return true;
        }
        
        // For aptitude topics, sub-topic is required
        const aptitudeInvalid = tc.isAptitude && !tc.subTopic;
        return aptitudeInvalid;
      }
    );
    if (invalidConfigs.length > 0) {
      setError("Please complete all configurations for all topics. Each topic must have at least one question type with valid difficulty and number of questions. Aptitude topics require a sub-topic selection.");
      return;
    }

    // Update topicConfigs to only include valid topics
    setTopicConfigs(validConfigs);

    // Transform topics to flat structure for API (one entry per question type config)
    const flattenedTopics = validConfigs.flatMap((tc) => {
      return tc.questionTypeConfigs.map((qtc) => ({
        topic: tc.topic,
        questionType: qtc.questionType,
        difficulty: qtc.difficulty,
        numQuestions: qtc.numQuestions,
        isAptitude: tc.isAptitude,
        subTopic: tc.subTopic,
        language: qtc.language,
        judge0_enabled: qtc.judge0_enabled,
      }));
    });

    // Check if we need to regenerate questions
    // Only regenerate if:
    // Check if we have preview questions that can be used instead of regenerating
    const hasPreviewQuestions = previewQuestions.length > 0;
    
    // 1. User has visited Review station (came back from Review)
    // 2. Edit mode was active
    // 3. Changes were made (compare with original configs)
    const shouldRegenerate = hasVisitedReviewStation && 
      JSON.stringify(validConfigs) !== JSON.stringify(originalTopicConfigsRef.current);

    // If we have preview questions and no changes, use them instead of regenerating
    if (hasPreviewQuestions && !shouldRegenerate && questions.length === 0) {
      console.log(`[Review] Using ${previewQuestions.length} preview questions for review page`);
      setQuestions(previewQuestions);
      setCurrentStation(3);
      return;
    }

    if (shouldRegenerate) {
      setGenerating(true);
      setError(null);

      try {
        const response = await axios.post("/api/assessments/generate-questions-from-config", {
          assessmentId,
          skill: selectedSkills.join(", "),
          topics: flattenedTopics,
        });

        if (response.data?.success) {
          const allQuestions: any[] = [];
          response.data.data.topics.forEach((topic: any) => {
            if (topic.questions && topic.questions.length > 0) {
              allQuestions.push(...topic.questions);
            }
          });
          setQuestions(allQuestions);
          // Update original configs after regeneration
          originalTopicConfigsRef.current = JSON.parse(JSON.stringify(validConfigs));
          setHasVisitedReviewStation(false);
          setCurrentStation(3);
        } else {
          setError("Failed to generate questions");
        }
      } catch (err: any) {
        console.error("Error generating questions:", err);
        setError(err.response?.data?.message || err.message || "Failed to generate questions");
      } finally {
        setGenerating(false);
      }
    } else {
      // No regeneration needed
      if (!hasVisitedReviewStation) {
        // First time generating, save original configs
        originalTopicConfigsRef.current = JSON.parse(JSON.stringify(validConfigs));
        setGenerating(true);
        setError(null);

        try {
          const response = await axios.post("/api/assessments/generate-questions-from-config", {
            assessmentId,
            skill: selectedSkills.join(", "),
            topics: flattenedTopics,
          });

          if (response.data?.success) {
            const allQuestions: any[] = [];
            response.data.data.topics.forEach((topic: any) => {
              if (topic.questions && topic.questions.length > 0) {
                allQuestions.push(...topic.questions);
              }
            });
            setQuestions(allQuestions);
            setCurrentStation(3);
          } else {
            setError("Failed to generate questions");
          }
        } catch (err: any) {
          console.error("Error generating questions:", err);
          setError(err.response?.data?.message || err.message || "Failed to generate questions");
        } finally {
          setGenerating(false);
        }
      } else {
        // Returning from Review without changes, just proceed
        setCurrentStation(3);
      }
    }
  };

  const handlePreviewQuestions = async () => {
    if (topicConfigs.length === 0) {
      setError("Please configure at least one topic");
      return;
    }

    // Ensure assessmentId exists - if not, try to get it from URL (edit mode) or show error
    let currentAssessmentId = assessmentId;
    if (!currentAssessmentId && isEditMode && id && typeof id === 'string') {
      currentAssessmentId = id;
      setAssessmentId(id);
    }
    
    if (!currentAssessmentId) {
      setError("Assessment not found. Please generate topics first.");
      return;
    }

    // Filter out topics with empty names
    const validConfigs = topicConfigs.filter((tc) => tc.topic.trim() !== "");
    if (validConfigs.length === 0) {
      setError("Please enter at least one topic name");
      return;
    }

    // Validate configurations
    const invalidConfigs = validConfigs.filter(
      (tc) => {
        if (!tc.questionTypeConfigs || tc.questionTypeConfigs.length === 0) {
          return true;
        }
        const invalidConfigs = tc.questionTypeConfigs.filter(
          (qtc) => !qtc.questionType || !qtc.difficulty || qtc.numQuestions < 1
        );
        if (invalidConfigs.length > 0) {
          return true;
        }
        const aptitudeInvalid = tc.isAptitude && !tc.subTopic;
        return aptitudeInvalid;
      }
    );
    if (invalidConfigs.length > 0) {
      setError("Please complete all configurations for all topics.");
      return;
    }

    // If generation is in progress, just reopen the modal to show progress
    if (previewGenerating) {
      setShowPreviewModal(true);
      return;
    }

    // Check if preview questions already exist in state - if so, just show them
    if (previewQuestions.length > 0) {
      console.log(`[Preview] Using existing ${previewQuestions.length} preview questions from state - skipping regeneration`);
      setShowPreviewModal(true);
      setCurrentPreviewIndex(0);
      return;
    }

    // Try to load existing preview questions from draft/backend - if found, don't regenerate
    if (currentAssessmentId) {
      try {
        const response = await axios.get(`/api/assessments/get-questions?assessmentId=${currentAssessmentId}`);
        console.log("[Preview] Checking for existing questions in backend for assessment:", currentAssessmentId);
        
        // Check for preview questions first (most reliable)
        if (response.data?.success) {
          const assessment = response.data.data?.assessment || response.data.data;
          
          // Check previewQuestions first
          if (assessment?.previewQuestions && Array.isArray(assessment.previewQuestions) && assessment.previewQuestions.length > 0) {
            console.log(`[Preview] Found ${assessment.previewQuestions.length} existing preview questions in backend - loading and skipping regeneration`);
            setPreviewQuestions(assessment.previewQuestions);
            // Also set questions if they don't exist
            if (!assessment.questions || assessment.questions.length === 0) {
              setQuestions(assessment.previewQuestions);
            }
            setCurrentPreviewIndex(0);
            setShowPreviewModal(true);
            return;
          }
          
          // Also check if regular questions exist (they can be used as preview)
          const questionsList = assessment?.questions || response.data.data?.questions;
          if (questionsList && Array.isArray(questionsList) && questionsList.length > 0) {
            console.log(`[Preview] Found ${questionsList.length} existing questions in backend - using as preview and skipping regeneration`);
            setPreviewQuestions(questionsList);
            setQuestions(questionsList);
            setCurrentPreviewIndex(0);
            setShowPreviewModal(true);
            return;
          }
        }
        
        console.log("[Preview] No existing questions found in backend - will generate new ones");
      } catch (err: any) {
        console.error("Error loading existing preview questions:", err);
        // Continue to generate new questions if loading fails
      }
    }
    
    // If we reach here, no existing questions were found - proceed with generation
    console.log("[Preview] No existing questions found - proceeding with generation");

    // Transform topics to flat structure - include ALL question type configs with numQuestions > 0
    const flattenedTopics = validConfigs.flatMap((tc) => {
      // Filter out question type configs with numQuestions = 0
      const validQuestionTypeConfigs = (tc.questionTypeConfigs || []).filter(
        (qtc) => qtc.numQuestions > 0
      );
      
      return validQuestionTypeConfigs.flatMap((qtc) => {
        // Create one entry per question (not per question type)
        const questions = [];
        for (let i = 1; i <= qtc.numQuestions; i++) {
          questions.push({
            topic: tc.topic,
            questionType: qtc.questionType,
            difficulty: qtc.difficulty,
            numQuestions: 1, // Each entry represents 1 question
            isAptitude: tc.isAptitude,
            subTopic: tc.subTopic,
            language: qtc.language,
            judge0_enabled: qtc.judge0_enabled,
            questionNumber: i, // Track which question number this is for this topic/type combo
          });
        }
        return questions;
      });
    });

    // Calculate total questions
    const totalQuestions = flattenedTopics.length;
    console.log(`[Preview] Starting generation: ${validConfigs.length} topics, ${totalQuestions} total questions to generate`);
    console.log(`[Preview] Flattened topics breakdown:`, flattenedTopics.map(t => ({
      topic: t.topic,
      questionType: t.questionType,
      difficulty: t.difficulty,
      questionNumber: t.questionNumber
    })));
    
    setPreviewProgress({ current: 0, total: totalQuestions });
    setPreviewGenerating(true);
    setPreviewQuestions([]);
    setCurrentPreviewIndex(0);
    setShowPreviewModal(true);
    setError(null);

    try {
      const allPreviewQuestions: any[] = [];
      let currentIndex = 0;

      // Create a flat list of all question generation tasks
      // flattenedTopics already has one entry per question, so we can use it directly
      const questionTasks: Array<{ topicConfig: any; questionNumber: number; taskIndex: number }> = flattenedTopics.map((topicConfig, idx) => {
        // topicConfig already represents a single question task
        return {
          topicConfig: {
            topic: topicConfig.topic,
            questionType: topicConfig.questionType,
            difficulty: topicConfig.difficulty,
            numQuestions: 1, // Each task generates 1 question
            isAptitude: topicConfig.isAptitude,
            subTopic: topicConfig.subTopic,
            language: topicConfig.language,
            judge0_enabled: topicConfig.judge0_enabled,
          },
          questionNumber: topicConfig.questionNumber || 1,
          taskIndex: idx, // Add unique task index
        };
      });
      
      console.log(`[Preview] Created ${questionTasks.length} question tasks from ${validConfigs.length} topics`);
      console.log(`[Preview] Task breakdown:`, questionTasks.map((t, idx) => 
        `${idx + 1}. ${t.topicConfig.topic} - ${t.topicConfig.questionType} (Q${t.questionNumber})`
      ));

      // Generate first 2 questions immediately (in parallel)
      const firstBatch = questionTasks.slice(0, Math.min(2, questionTasks.length));
      console.log(`[Preview] Generating first batch: ${firstBatch.length} questions`);
      
      const firstBatchPromises = firstBatch.map((task, idx) => {
        console.log(`[Preview] First batch task ${idx + 1}: ${task.topicConfig.topic} - ${task.topicConfig.questionType} (Q${task.questionNumber}, taskIndex=${task.taskIndex})`);
        return generateSingleQuestion(task.topicConfig, task.questionNumber, currentAssessmentId).then((question) => {
          // Add task index to question for tracking
          if (question) {
            question._taskIndex = task.taskIndex;
            question._questionNumber = task.questionNumber;
          }
          return question;
        });
      });

      // Wait for first batch and collect results
      const firstBatchResults = await Promise.all(firstBatchPromises);
      
      // Add all first batch questions to the array (check for duplicates)
      firstBatchResults.forEach((question, idx) => {
        if (question) {
          // Check if this question already exists (avoid duplicates)
          const questionExists = allPreviewQuestions.some((q: any) => {
            const qText = q.questionText || q.question || '';
            const newQText = question.questionText || question.question || '';
            return qText === newQText && q.topic === question.topic && q.type === question.type;
          });
          
          if (questionExists) {
            console.warn(`[Preview] First batch: Question ${idx + 1} already exists, skipping duplicate`);
          } else {
            allPreviewQuestions.push(question);
            currentIndex++;
            console.log(`[Preview] First batch: Added question ${currentIndex}/${totalQuestions} - ${question.topic || 'Unknown'} - ${question.type || 'Unknown'}`);
          }
        } else {
          console.warn(`[Preview] First batch: Failed to generate question ${idx + 1}`);
        }
      });
      
      // Update state once with all first batch questions
      setPreviewProgress({ current: currentIndex, total: totalQuestions });
      const firstBatchQuestions = [...allPreviewQuestions];
      setPreviewQuestions(firstBatchQuestions);
      console.log(`[Preview] First batch: Updated state with ${firstBatchQuestions.length} questions`);
      setShowPreviewModal(true);

      // Queue the rest to generate one after another
      const remainingTasks = questionTasks.slice(firstBatch.length);
      console.log(`[Preview] Generating remaining ${remainingTasks.length} questions sequentially`);
      
      for (let taskIdx = 0; taskIdx < remainingTasks.length; taskIdx++) {
        const task = remainingTasks[taskIdx];
        console.log(`[Preview] Sequential task ${taskIdx + 1}/${remainingTasks.length}: ${task.topicConfig.topic} - ${task.topicConfig.questionType} (Q${task.questionNumber})`);
        
        const question = await generateSingleQuestion(task.topicConfig, task.questionNumber, currentAssessmentId);
        if (question) {
          // Add task index to question for tracking
          question._taskIndex = task.taskIndex;
          question._questionNumber = task.questionNumber;
          
          // Check if this question already exists (avoid duplicates) - check by task index
          const questionExists = allPreviewQuestions.some((q: any) => {
            return q._taskIndex === task.taskIndex;
          });
          
          if (questionExists) {
            console.warn(`[Preview] Sequential: Question with taskIndex ${task.taskIndex} already exists, skipping duplicate`);
          } else {
            allPreviewQuestions.push(question);
            currentIndex++;
            
            // Update progress
            setPreviewProgress({ current: currentIndex, total: totalQuestions });
            
            // Update state with new array reference
            const updatedQuestions = [...allPreviewQuestions];
            setPreviewQuestions(updatedQuestions);
            
            // Preserve current preview index when adding new questions
            // Don't change the index - let the user navigate freely
            // The index will be adjusted by the useEffect if it goes out of bounds
            
            console.log(`[Preview] Sequential: Added question ${currentIndex}/${totalQuestions} at array index ${updatedQuestions.length - 1}. Topic: ${question.topic || 'Unknown'}, Type: ${question.type || 'Unknown'}, taskIndex: ${task.taskIndex}`);
            console.log(`[Preview] Sequential: Question array now has ${updatedQuestions.length} questions:`, updatedQuestions.map((q: any, idx: number) => ({
              arrayIndex: idx,
              taskIndex: q._taskIndex,
              topic: q.topic,
              type: q.type,
              preview: (q.questionText || q.question || '').substring(0, 30)
            })));
          }
          
          // Keep modal open during generation
          setShowPreviewModal(true);
          
          // Small delay to ensure React processes the state update before next question
          await new Promise(resolve => setTimeout(resolve, 100));
          
          // Note: Preview questions will be saved automatically when navigating away (browser back or Back to Dashboard button)
        } else {
          console.warn(`[Preview] Sequential: Failed to generate question ${currentIndex + 1}/${totalQuestions} for topic ${task.topicConfig.topic} - ${task.topicConfig.questionType}`);
        }
      }

      // Final update to ensure all questions are in state
      setPreviewQuestions((prev) => {
        const final = [...allPreviewQuestions];
        console.log(`[Preview] Final: Setting previewQuestions to ${final.length} questions (prev had ${prev.length})`);
        
        // Also update questions state for review page
        if (final.length > 0) {
          console.log(`[Preview] Also updating questions state with ${final.length} questions for review page`);
          setQuestions(final);
        }
        
        return final;
      });
      
      // Preserve current index when generation completes (don't reset to 0 if user navigated)
      setCurrentPreviewIndex((prevIndex) => {
        const finalCount = allPreviewQuestions.length;
        if (finalCount > 0 && prevIndex >= finalCount) {
          // If index is out of bounds, adjust to last question
          return finalCount - 1;
        }
        // Otherwise, preserve the current index (user might have navigated)
        return prevIndex;
      });
      
      // Keep modal open after generation completes
      setShowPreviewModal(true);
      
      // Note: Preview questions will be saved automatically when navigating away (browser back or Back to Dashboard button)
    } catch (err: any) {
      console.error("Error generating preview questions:", err);
      setError(err.response?.data?.message || err.message || "Failed to generate preview questions");
      setShowPreviewModal(false);
    } finally {
      setPreviewGenerating(false);
    }
  };

  const generateSingleQuestion = async (topicConfig: any, questionNumber: number, assessmentIdToUse?: string): Promise<any | null> => {
    const idToUse = assessmentIdToUse || assessmentId;
    if (!idToUse) {
      console.error("Assessment ID is required for generating preview questions");
      return null;
    }
    
    try {
      const response = await axios.post("/api/assessments/generate-questions-from-config", {
        assessmentId: idToUse,
        skill: selectedSkills.join(", "),
        topics: [{
          ...topicConfig,
          numQuestions: 1, // Generate only 1 question
        }],
      });

      if (response.data?.success && response.data.data.topics) {
        const topic = response.data.data.topics[0];
        if (topic.questions && topic.questions.length > 0) {
          return topic.questions[0];
        }
      }
      return null;
    } catch (err: any) {
      console.error(`Error generating question ${questionNumber} for topic ${topicConfig.topic}:`, err);
      return null;
    }
  };

  const handleRemoveQuestion = (questionIndex: number) => {
    setQuestions(questions.filter((_, idx) => idx !== questionIndex));
  };

  const handleEditQuestion = (questionIndex: number) => {
    const question = previewQuestions[questionIndex];
    if (question) {
      setEditingQuestion({ ...question });
      setEditingQuestionIndex(questionIndex);
    }
  };

  const handleSaveEditedQuestion = async () => {
    if (editingQuestionIndex === null || !editingQuestion || !assessmentId) {
      return;
    }

    try {
      const question = previewQuestions[editingQuestionIndex];
      const topic = question.topic;

      // Update the question in preview questions
      const updated = [...previewQuestions];
      updated[editingQuestionIndex] = { ...editingQuestion };
      setPreviewQuestions(updated);

      // Note: Draft will be saved automatically when navigating away (browser back or Back to Dashboard button)

      setEditingQuestionIndex(null);
      setEditingQuestion(null);
      setError(null);
    } catch (err: any) {
      console.error("Error saving edited question:", err);
      setError(err.response?.data?.message || err.message || "Failed to save edited question");
    }
  };

  const handleRegenerateQuestion = async (questionIndex: number) => {
    if (!assessmentId) {
      setError("Assessment ID not found");
      return;
    }

    setRegeneratingQuestionIndex(questionIndex);
    setError(null);

    try {
      const question = previewQuestions[questionIndex];
      if (!question) {
        setError("Question not found");
        return;
      }

      // Get skills from assessment if not in state
      let skillsToUse = selectedSkills;
      if (!skillsToUse || skillsToUse.length === 0) {
        try {
          const assessmentResponse = await axios.get(`/api/assessments/get-questions?assessmentId=${assessmentId}`);
          if (assessmentResponse.data?.success) {
            const assessment = assessmentResponse.data.data.assessment || assessmentResponse.data.data;
            if (assessment.selectedSkills && assessment.selectedSkills.length > 0) {
              skillsToUse = assessment.selectedSkills;
            }
          }
        } catch (err) {
          console.error("Error fetching skills:", err);
        }
      }

      if (!skillsToUse || skillsToUse.length === 0) {
        setError("No skills found. Please go back to Station 1 and select skills.");
        setRegeneratingQuestionIndex(null);
        return;
      }

      // Generate a new question with the same topic and type
      const topicConfig = {
        topic: question.topic,
        questionType: question.type,
        difficulty: question.difficulty || "Medium",
        numQuestions: 1,
        isAptitude: question.isAptitude || false,
        subTopic: question.subTopic,
        language: question.language,
        judge0_enabled: question.judge0_enabled,
      };

      const response = await axios.post("/api/assessments/generate-questions-from-config", {
        assessmentId,
        skill: skillsToUse.join(", "),
        topics: [topicConfig],
      });

      if (response.data?.success && response.data.data.topics) {
        const topic = response.data.data.topics[0];
        if (topic.questions && topic.questions.length > 0) {
          const newQuestion = topic.questions[0];
          // Preserve the topic and other metadata
          newQuestion.topic = question.topic;
          
          // Update the question in preview questions
          const updated = [...previewQuestions];
          updated[questionIndex] = newQuestion;
          setPreviewQuestions(updated);

          // Note: Draft will be saved automatically when navigating away (browser back or Back to Dashboard button)
        } else {
          setError("Failed to generate new question");
        }
      } else {
        setError("Failed to regenerate question");
      }
    } catch (err: any) {
      console.error("Error regenerating question:", err);
      setError(err.response?.data?.message || err.message || "Failed to regenerate question");
    } finally {
      setRegeneratingQuestionIndex(null);
    }
  };

  const handleAddCandidate = () => {
    if (candidateEmail.trim() && candidateName.trim()) {
      // Check if email already exists
      if (candidates.some((c) => c.email.toLowerCase() === candidateEmail.trim().toLowerCase())) {
        setError("This email is already added");
        return;
      }
      setCandidates([...candidates, { email: candidateEmail.trim(), name: candidateName.trim() }]);
      setCandidateEmail("");
      setCandidateName("");
      setError(null);
    }
  };

  const handleRemoveCandidate = (email: string) => {
    setCandidates(candidates.filter((c) => c.email !== email));
  };

  const handleCsvUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.name.endsWith('.csv')) {
      setError("Please upload a CSV file");
      return;
    }

    setUploadingCsv(true);
    setError(null);

    try {
      const text = await file.text();
      const lines = text.split('\n').filter(line => line.trim());
      
      if (lines.length === 0) {
        setError("CSV file is empty");
        setUploadingCsv(false);
        return;
      }

      // Parse header row
      const header = lines[0].split(',').map(h => h.trim().toLowerCase());
      const nameIndex = header.findIndex(h => h === 'name');
      const emailIndex = header.findIndex(h => h === 'email');

      if (nameIndex === -1 || emailIndex === -1) {
        setError("CSV must contain 'name' and 'email' columns");
        setUploadingCsv(false);
        return;
      }

      // Parse data rows
      const newCandidates: Array<{ email: string; name: string }> = [];
      const existingEmails = new Set(candidates.map(c => c.email.toLowerCase()));
      const duplicateEmails: string[] = [];
      const invalidRows: number[] = [];

      for (let i = 1; i < lines.length; i++) {
        const row = lines[i].split(',').map(cell => cell.trim());
        const email = row[emailIndex]?.trim();
        const name = row[nameIndex]?.trim();

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!email || !name || !emailRegex.test(email)) {
          invalidRows.push(i + 1);
          continue;
        }

        // Check for duplicates in CSV
        if (newCandidates.some(c => c.email.toLowerCase() === email.toLowerCase())) {
          duplicateEmails.push(email);
          continue;
        }

        // Check for duplicates with existing candidates
        if (existingEmails.has(email.toLowerCase())) {
          duplicateEmails.push(email);
          continue;
        }

        newCandidates.push({ email, name });
        existingEmails.add(email.toLowerCase());
      }

      if (newCandidates.length === 0) {
        let errorMsg = "No valid candidates found in CSV. ";
        if (invalidRows.length > 0) {
          errorMsg += `Invalid rows: ${invalidRows.slice(0, 5).join(', ')}${invalidRows.length > 5 ? '...' : ''}. `;
        }
        if (duplicateEmails.length > 0) {
          errorMsg += `Duplicate emails: ${duplicateEmails.slice(0, 5).join(', ')}${duplicateEmails.length > 5 ? '...' : ''}.`;
        }
        setError(errorMsg);
        setUploadingCsv(false);
        return;
      }

      // Add new candidates
      setCandidates([...candidates, ...newCandidates]);
      
      // Show success message with warnings if any
      if (invalidRows.length > 0 || duplicateEmails.length > 0) {
        let warningMsg = `Successfully added ${newCandidates.length} candidate(s). `;
        if (invalidRows.length > 0) {
          warningMsg += `Skipped ${invalidRows.length} invalid row(s). `;
        }
        if (duplicateEmails.length > 0) {
          warningMsg += `Skipped ${duplicateEmails.length} duplicate email(s).`;
        }
        setError(warningMsg);
      } else {
        setError(null);
      }

    } catch (err: any) {
      console.error("Error parsing CSV:", err);
      setError("Error reading CSV file. Please check the file format.");
    } finally {
      setUploadingCsv(false);
      // Reset file input
      event.target.value = '';
    }
  };

  const handleBackToDashboard = async () => {
    if (!assessmentId) {
      // If no assessment ID, just navigate to dashboard
      router.push("/dashboard");
      return;
    }

    try {
      // Ensure we have a title - use job designation as fallback
      const titleToSave = finalTitle || (jobDesignation.trim() ? `Assessment for ${jobDesignation.trim()}` : "Untitled Assessment");
      
      // Save all current state to draft before navigating
      const draftData: any = {
        assessmentId: assessmentId,
        title: titleToSave,
        description: finalDescription || "",
        jobDesignation: jobDesignation.trim(),
        selectedSkills: selectedSkills,
        experienceMin: experienceMin,
        experienceMax: experienceMax,
      };

      // Add topics if configured
      if (topicConfigs.length > 0) {
        draftData.topics = topicConfigs;
      }

      // Add preview questions if available
      if (previewQuestions.length > 0) {
        draftData.previewQuestions = previewQuestions;
      }

      // Add questions if available (from Station 3)
      if (questions.length > 0) {
        draftData.questions = questions;
        draftData.questionTypeTimes = questionTypeTimes;
        draftData.enablePerSectionTimers = enablePerSectionTimers;
        draftData.passPercentage = passPercentage;
      }

      // Add schedule if available (from Station 4)
      if (startTime && endTime) {
        // Normalize datetime strings to ISO format
        const normalizeDateTime = (dt: string): string => {
          if (!dt) return dt;
          if (dt.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)) {
            const dtWithSeconds = dt + ":00";
            const istDate = new Date(dtWithSeconds + "+05:30");
            if (!isNaN(istDate.getTime())) {
              return istDate.toISOString();
            } else {
              return dt + ":00Z";
            }
          }
          if (dt.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/)) {
            return dt + "Z";
          }
          return dt;
        };
        
        draftData.schedule = {
          startTime: normalizeDateTime(startTime),
          endTime: normalizeDateTime(endTime),
        };
      }

      // Add candidates if available (from Station 5)
      if (candidates.length > 0) {
        draftData.candidates = candidates;
      }

      if (assessmentUrl) {
        draftData.assessmentUrl = assessmentUrl;
      }

      // Save draft
      await axios.put("/api/assessments/update-draft", draftData);
      
      // Navigate to dashboard
      router.push("/dashboard");
    } catch (err: any) {
      console.error("Error saving draft before navigating:", err);
      // Still navigate to dashboard even if save fails
      router.push("/dashboard");
    }
  };

  const handleGenerateUrl = async () => {
    if (!assessmentId) {
      setError("Assessment ID not found");
      return;
    }

    // Generate unique URL - using assessment ID and a random token
    const token = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    const url = `${window.location.origin}/assessment/${assessmentId}/${token}`;
    setAssessmentUrl(url);

    // Save schedule and candidates to backend
    try {
      // Normalize datetime strings to ISO format with seconds and timezone
      // datetime-local input gives format: YYYY-MM-DDTHH:MM (no seconds, no timezone)
      // We need to convert IST (UTC+5:30) to UTC and add seconds
      const normalizeDateTime = (dt: string): string => {
        if (!dt) return dt;
        
        // If format is YYYY-MM-DDTHH:MM (missing seconds), add :00
        if (dt.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)) {
          // Parse as IST (UTC+5:30) and convert to UTC ISO string
          // datetime-local input is in local timezone, but we treat it as IST
          // Create a date object assuming IST timezone
          const dtWithSeconds = dt + ":00";
          // Create date assuming IST (UTC+5:30)
          const istDate = new Date(dtWithSeconds + "+05:30");
          
          if (!isNaN(istDate.getTime())) {
            // Convert to ISO string (UTC)
            return istDate.toISOString();
          } else {
            // Fallback: just add seconds and Z
            return dt + ":00Z";
          }
        }
        
        // If already has seconds but no timezone, add Z
        if (dt.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/)) {
          return dt + "Z";
        }
        
        return dt;
      };

      await axios.post("/api/assessments/update-schedule-and-candidates", {
        assessmentId,
        startTime: normalizeDateTime(startTime),
        endTime: normalizeDateTime(endTime),
        candidates,
        assessmentUrl: url,
        token,
      });
    } catch (err: any) {
      console.error("Error saving schedule and candidates:", err);
      setError("Failed to save schedule and candidates");
    }
  };

  const handleCopyUrl = () => {
    if (assessmentUrl) {
      navigator.clipboard.writeText(assessmentUrl);
      // You could show a toast notification here
      alert("URL copied to clipboard!");
    }
  };


  const handleFinalize = async () => {

    setLoading(true);
    setError(null);

    try {
      // First, update all questions in the assessment
      // Group questions by topic
      const questionsByTopic: { [key: string]: any[] } = {};
      questions.forEach((q) => {
        const topic = q.topic || "Unknown";
        if (!questionsByTopic[topic]) {
          questionsByTopic[topic] = [];
        }
        questionsByTopic[topic].push(q);
      });

      // Update questions for each topic
      for (const [topic, topicQuestions] of Object.entries(questionsByTopic)) {
        try {
          await axios.put("/api/assessments/update-questions", {
            assessmentId,
            topic,
            updatedQuestions: topicQuestions,
          });
        } catch (err) {
          console.error(`Error updating questions for topic ${topic}:`, err);
        }
      }

      // Then finalize with questionTypeTimes, enablePerSectionTimers flag, and passPercentage
      // Fetch the assessment to get the title and description from Station 1
      let assessmentTitle = "";
      let assessmentDescription = "";
      try {
        const assessmentResponse = await axios.get(`/api/assessments/get-questions?assessmentId=${assessmentId}`);
        if (assessmentResponse.data?.success && assessmentResponse.data.data?.assessment) {
          assessmentTitle = assessmentResponse.data.data.assessment.title || "";
          assessmentDescription = assessmentResponse.data.data.assessment.description || "";
        }
      } catch (err) {
        console.error("Error fetching assessment for title:", err);
      }

      const response = await axios.post("/api/assessments/finalize", {
        assessmentId,
        title: assessmentTitle.trim() || "Untitled Assessment",
        description: assessmentDescription.trim() || undefined,
        questionTypeTimes: enablePerSectionTimers ? questionTypeTimes : undefined,
        enablePerSectionTimers: enablePerSectionTimers,
        passPercentage: passPercentage,
      });

      if (response.data?.success) {
        // Clear draft from localStorage since assessment is finalized
        try {
          localStorage.removeItem('currentDraftAssessmentId');
        } catch (err) {
          console.error("Error clearing draft ID from localStorage:", err);
        }
        setCurrentStation(4);
      } else {
        setError("Failed to finalize assessment");
      }
    } catch (err: any) {
      console.error("Error finalizing assessment:", err);
      setError(err.response?.data?.message || err.message || "Failed to finalize assessment");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ backgroundColor: "#f1dcba", minHeight: "100vh", padding: "2rem 0" }}>
      <div className="container">
        <div className="card">
          {/* Progress Line */}
          <div style={{ marginBottom: "3rem" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                position: "relative",
                marginBottom: "1rem",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: "50%",
                  left: 0,
                  right: 0,
                  height: "3px",
                  backgroundColor: "#e2e8f0",
                  zIndex: 0,
                }}
              />
              <div
                style={{
                  position: "absolute",
                  top: "50%",
                  left: 0,
                  width: currentStation >= 5 ? "100%" : currentStation >= 4 ? "75%" : currentStation >= 3 ? "50%" : currentStation >= 2 ? "25%" : "0%",
                  height: "3px",
                  backgroundColor: "#6953a3",
                  zIndex: 1,
                  transition: "width 0.3s ease",
                }}
              />
              {[1, 2, 3, 4, 5].map((station) => (
                <div
                  key={station}
                  style={{
                    position: "relative",
                    zIndex: 2,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    flex: 1,
                  }}
                >
                  <div
                    style={{
                      width: "40px",
                      height: "40px",
                      borderRadius: "50%",
                      backgroundColor: currentStation >= station ? "#6953a3" : "#e2e8f0",
                      color: currentStation >= station ? "#ffffff" : "#64748b",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 700,
                      fontSize: "1.125rem",
                      transition: "all 0.3s ease",
                    }}
                  >
                    {station}
                  </div>
                  <span
                    style={{
                      marginTop: "0.5rem",
                      fontSize: "0.875rem",
                      color: currentStation >= station ? "#6953a3" : "#64748b",
                      fontWeight: currentStation >= station ? 600 : 400,
                    }}
                  >
                    {station === 1 ? "Topics" : station === 2 ? "Configure" : station === 3 ? "Review" : station === 4 ? "Schedule" : "Candidates"}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {error && (
            <div className="alert alert-error" style={{ marginBottom: "1.5rem" }}>
              {error}
            </div>
          )}

          {loadingDraft && (
            <div className="alert" style={{ marginBottom: "1.5rem", backgroundColor: "#f0f9ff", border: "1px solid #3b82f6" }}>
              Loading draft assessment...
            </div>
          )}

          {/* Station 1: Topics */}
          {currentStation === 1 && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                <div style={{ flex: 1 }}>
              <h1 style={{ marginBottom: "0.5rem", fontSize: "2rem", color: "#1a1625", fontWeight: 700 }}>
                {isEditMode ? "Edit Assessment" : "Create Assessment"}
              </h1>
              <p style={{ color: "#6b6678", marginBottom: "2rem", fontSize: "1rem" }}>
                {isEditMode ? "Edit your assessment details" : "Enter a job designation or domain to get started"}
              </p>
                </div>
                <button
                  type="button"
                  onClick={handleBackToDashboard}
                  className="btn-secondary"
                  style={{ 
                    marginLeft: "1rem",
                    whiteSpace: "nowrap",
                    padding: "0.75rem 1.5rem",
                    fontSize: "0.875rem"
                  }}
                >
                  Back to Dashboard
                </button>
              </div>

              <div style={{ marginBottom: "2rem" }}>
                <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1e293b" }}>
                  Assessment Title <span style={{ color: "#dc2626" }}>*</span>
                </label>
                <input
                  type="text"
                  value={finalTitle}
                  onChange={(e) => setFinalTitle(e.target.value)}
                  placeholder="Enter assessment title"
                  style={{
                    width: "100%",
                    padding: "0.75rem",
                    border: "1px solid #e2e8f0",
                    borderRadius: "0.5rem",
                    fontSize: "1rem",
                  }}
                />
              </div>

              <div style={{ marginBottom: "2rem" }}>
                <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1e293b" }}>
                  Job Designation / Domain *
                </label>
                  <input
                    type="text"
                    value={jobDesignation}
                    onChange={(e) => setJobDesignation(e.target.value)}
                    placeholder="e.g., Software Engineering, Aptitude, Data Scientist, Frontend Developer"
                    style={{
                    width: "100%",
                      padding: "0.75rem",
                      border: "1px solid #e2e8f0",
                      borderRadius: "0.5rem",
                      fontSize: "1rem",
                    }}
                  />
              </div>

              {/* Topic Cards Display */}
              {topicCards.length > 0 && (isEditMode || !hasVisitedConfigureStation) && (
                <div style={{ marginBottom: "2rem" }}>
                  <label style={{ display: "block", marginBottom: "0.75rem", fontWeight: 600, color: "#1e293b" }}>
                    Related Technologies & Skills
                  </label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
                    {topicCards.map((card) => (
                      <button
                        key={card}
                        type="button"
                        onClick={() => handleCardClick(card)}
                        disabled={!isEditMode && selectedSkills.includes(card)}
                        style={{
                          padding: "0.5rem 1rem",
                          border: `1px solid ${selectedSkills.includes(card) ? "#6953a3" : "#e2e8f0"}`,
                          borderRadius: "0.5rem",
                          backgroundColor: selectedSkills.includes(card) ? "#eff6ff" : "#ffffff",
                          color: selectedSkills.includes(card) ? "#1e40af" : "#475569",
                          cursor: (!isEditMode && selectedSkills.includes(card)) ? "default" : "pointer",
                          fontSize: "0.875rem",
                          fontWeight: selectedSkills.includes(card) ? 600 : 400,
                          opacity: (!isEditMode && selectedSkills.includes(card)) ? 0.7 : 1,
                        }}
                      >
                        {card} {selectedSkills.includes(card) && "✓"}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ marginBottom: "2rem" }}>
                <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1e293b" }}>
                  Experience Range (Years)
                </label>
                <div
                  ref={sliderRef}
                  style={{
                    position: "relative",
                    width: "100%",
                    height: "6px",
                    backgroundColor: "#e2e8f0",
                    borderRadius: "3px",
                    marginTop: "2rem",
                    marginBottom: "1rem",
                    cursor: (isEditMode || !hasVisitedConfigureStation) ? "pointer" : "default",
                    opacity: (isEditMode || !hasVisitedConfigureStation) ? 1 : 0.6,
                  }}
                >
                  <div
                    ref={minHandleRef}
                    style={{
                      position: "absolute",
                      width: "20px",
                      height: "20px",
                      backgroundColor: "#6953a3",
                      borderRadius: "50%",
                      top: "50%",
                      transform: "translate(-50%, -50%)",
                      cursor: (isEditMode || !hasVisitedConfigureStation) ? "grab" : "default",
                      zIndex: 3,
                      userSelect: "none",
                      touchAction: "none",
                      pointerEvents: (isEditMode || !hasVisitedConfigureStation) ? "auto" : "none",
                    }}
                  />
                  <div
                    ref={maxHandleRef}
                    style={{
                      position: "absolute",
                      width: "20px",
                      height: "20px",
                      backgroundColor: "#6953a3",
                      borderRadius: "50%",
                      top: "50%",
                      transform: "translate(-50%, -50%)",
                      cursor: (isEditMode || !hasVisitedConfigureStation) ? "grab" : "default",
                      zIndex: 3,
                      userSelect: "none",
                      touchAction: "none",
                      pointerEvents: (isEditMode || !hasVisitedConfigureStation) ? "auto" : "none",
                    }}
                  />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.875rem", color: "#64748b", marginTop: "0.5rem" }}>
                  <span>{experienceMin} years</span>
                  <span>{experienceMax} years</span>
                </div>
                <div style={{ textAlign: "center", fontSize: "0.875rem", color: "#6953a3", fontWeight: 600, marginTop: "0.25rem" }}>
                  {experienceMin}-{experienceMax} years
                </div>
              </div>

              {/* Skills we want to assess section */}
              <div style={{ marginBottom: "2rem" }}>
                <label style={{ display: "block", marginBottom: "0.75rem", fontWeight: 600, color: "#1e293b" }}>
                  Skills we want to assess *
                </label>
                {selectedSkills.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginBottom: "1rem" }}>
                    {selectedSkills.map((skill) => (
                      <div
                        key={skill}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "0.5rem",
                          backgroundColor: "#eff6ff",
                          color: "#1e40af",
                          padding: "0.5rem 1rem",
                          borderRadius: "0.5rem",
                          fontSize: "0.875rem",
                          fontWeight: 500,
                        }}
                      >
                        {skill}
                        {(isEditMode || !hasVisitedConfigureStation) && (
                          <button
                            type="button"
                            onClick={() => handleRemoveSkill(skill)}
                            style={{
                              background: "none",
                              border: "none",
                              color: "#1e40af",
                              cursor: "pointer",
                              padding: 0,
                              fontSize: "1.125rem",
                              lineHeight: 1,
                            }}
                          >
                            ×
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {(isEditMode || !hasVisitedConfigureStation) && (
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <input
                      type="text"
                      value={manualSkillInput}
                      onChange={(e) => setManualSkillInput(e.target.value)}
                      onKeyPress={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleAddManualSkill();
                        }
                      }}
                      placeholder="Enter technology name (e.g., Python, React, HTML)"
                      style={{
                        flex: 1,
                        padding: "0.75rem",
                        border: "1px solid #e2e8f0",
                        borderRadius: "0.5rem",
                        fontSize: "1rem",
                      }}
                    />
                    <button
                      type="button"
                      onClick={handleAddManualSkill}
                      className="btn-secondary"
                      disabled={!manualSkillInput.trim()}
                      style={{ marginTop: 0, whiteSpace: "nowrap", padding: "0.75rem 1.5rem" }}
                    >
                      Add
                    </button>
                  </div>
                )}
              </div>

              <div style={{ display: "flex", gap: "1rem", marginTop: "2rem" }}>
                {isEditMode ? (
                  <>
                    {/* Back button not needed on Station 1 */}
                    <button
                      type="button"
                      onClick={async () => {
                        if (selectedSkills.length === 0) {
                          setError("Please select at least one skill to assess");
                          return;
                        }
                        await handleGenerateTopics();
                      }}
                      className="btn-primary"
                      disabled={loading || selectedSkills.length === 0}
                      style={{ flex: 1 }}
                    >
                      {loading ? "Regenerating Topics..." : "Regenerate Topics"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setCurrentStation(2)}
                      className="btn-primary"
                      disabled={false}
                      style={{ flex: 1 }}
                    >
                      Next
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={handleNextToStation2}
                    className="btn-primary"
                    disabled={loading || selectedSkills.length === 0 || !jobDesignation.trim()}
                    style={{ flex: 1 }}
                  >
                    {loading ? "Generating Topics..." : "Next"}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Station 2: Configure */}
          {currentStation === 2 && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                <div style={{ flex: 1 }}>
              <h1 style={{ marginBottom: "0.5rem", fontSize: "2rem", color: "#1a1625", fontWeight: 700 }}>
                Configure Topics
              </h1>
                  <p style={{ color: "#6b6678", marginBottom: "1rem", fontSize: "1rem" }}>
                Configure question type, difficulty, and number of questions for each topic. You can also add your own topics.
              </p>
                </div>
                <button
                  type="button"
                  onClick={handleBackToDashboard}
                  className="btn-secondary"
                  style={{ 
                    marginLeft: "1rem",
                    whiteSpace: "nowrap",
                    padding: "0.75rem 1.5rem",
                    fontSize: "0.875rem"
                  }}
                >
                  Back to Dashboard
                </button>
              </div>

              {/* Preview Questions Button */}
                <div style={{ marginBottom: "1.5rem", display: "flex", justifyContent: "flex-end" }}>
                  <button
                    type="button"
                  onClick={handlePreviewQuestions}
                  disabled={topicConfigs.length === 0}
                    className="btn-secondary"
                  style={{ 
                    marginTop: 0,
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                  }}
                >
                  Preview Questions
                  {previewQuestions.length > 0 && (
                    <span style={{ fontSize: "0.875rem", color: "#64748b" }}>
                      ({previewQuestions.length})
                    </span>
                  )}
                  </button>
                </div>



              <div style={{ overflowX: "auto", marginBottom: "1rem" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ backgroundColor: "#f8fafc" }}>
                      <th style={{ padding: "1rem", textAlign: "left", borderBottom: "2px solid #e2e8f0", fontWeight: 600, color: "#1e293b" }}>
                        Topic
                      </th>
                      <th style={{ padding: "1rem", textAlign: "left", borderBottom: "2px solid #e2e8f0", fontWeight: 600, color: "#1e293b" }}>
                        Question Type
                      </th>
                      <th style={{ padding: "1rem", textAlign: "left", borderBottom: "2px solid #e2e8f0", fontWeight: 600, color: "#1e293b" }}>
                        Difficulty
                      </th>
                      <th style={{ padding: "1rem", textAlign: "left", borderBottom: "2px solid #e2e8f0", fontWeight: 600, color: "#1e293b" }}>
                        Number of Questions
                      </th>
                      <th style={{ padding: "1rem", textAlign: "left", borderBottom: "2px solid #e2e8f0", fontWeight: 600, color: "#1e293b" }}>
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {topicConfigs && topicConfigs.length > 0 ? (
                      topicConfigs.flatMap((config, topicIndex) => {
                      const isAptitude = config.isAptitude || false;
                      const isDisabled = false; // Always enabled for editing
                      const aptitudeQuestionTypes = getAptitudeQuestionTypes(config);
                      
                      // Ensure at least one question type config exists
                      if (!config.questionTypeConfigs || config.questionTypeConfigs.length === 0) {
                        config.questionTypeConfigs = [{
                          questionType: isAptitude ? "MCQ" : (availableQuestionTypes[0] || QUESTION_TYPES[0]),
                          difficulty: "Medium",
                          numQuestions: 1,
                        }];
                      }
                      
                      return config.questionTypeConfigs.map((qtConfig, configIndex) => {
                        const isFirstRow = configIndex === 0;
                        const isLastRow = configIndex === config.questionTypeConfigs.length - 1;
                      
                      return (
                          <tr key={`${topicIndex}-${configIndex}`} style={{ borderBottom: "1px solid #e2e8f0" }}>
                            <td style={{ padding: "1rem", verticalAlign: "top" }}>
                              {isFirstRow && (
                                <>
                                  {!isAptitude && (
                                    <button
                                      type="button"
                                      onClick={() => handleRegenerateSingleTopic(topicIndex)}
                                      disabled={regeneratingTopicIndex === topicIndex}
                                      title="Regenerate this topic"
                                      style={{
                                        marginBottom: "0.5rem",
                                        padding: "0.375rem 0.75rem",
                                        background: "#3b82f6",
                                        border: "none",
                                        color: "#ffffff",
                                        cursor: regeneratingTopicIndex === topicIndex ? "not-allowed" : "pointer",
                                        fontSize: "0.75rem",
                                        fontWeight: 500,
                                        borderRadius: "0.375rem",
                                        opacity: regeneratingTopicIndex === topicIndex ? 0.6 : 1,
                                      }}
                                    >
                                      {regeneratingTopicIndex === topicIndex ? "Regenerating..." : "Regenerate"}
                                    </button>
                                  )}
                          {isAptitude ? (
                            // Aptitude topic: show main topic name and sub-topic dropdown
                            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                              <div style={{ 
                                padding: "0.5rem",
                                fontSize: "0.875rem",
                                fontWeight: 600,
                                color: "#1e293b",
                                backgroundColor: "#f1f5f9",
                                borderRadius: "0.25rem",
                              }}>
                                {config.topic}
                              </div>
                              <select
                                value={config.subTopic || ""}
                                        onChange={(e) => handleUpdateTopicConfig(topicIndex, "subTopic", e.target.value)}
                                disabled={isDisabled}
                                style={{
                                  width: "100%",
                                  padding: "0.5rem",
                                  border: "1px solid #e2e8f0",
                                  borderRadius: "0.5rem",
                                  fontSize: "0.875rem",
                                  backgroundColor: isDisabled ? "#f1f5f9" : "#ffffff",
                                  cursor: isDisabled ? "not-allowed" : "pointer",
                                  opacity: isDisabled ? 0.6 : 1,
                                }}
                              >
                                <option value="">Select sub-topic</option>
                                {(config.availableSubTopics || []).map((subTopic: string) => (
                                  <option key={subTopic} value={subTopic}>
                                    {subTopic}
                                  </option>
                                ))}
                              </select>
                            </div>
                          ) : (
                            // Technical topic: show editable input
                            <input
                              type="text"
                              value={config.topic}
                                      onChange={(e) => handleUpdateTopicConfig(topicIndex, "topic", e.target.value)}
                              placeholder="Enter topic name"
                              disabled={isDisabled}
                              style={{
                                width: "100%",
                                padding: "0.5rem",
                                border: "1px solid #e2e8f0",
                                borderRadius: "0.5rem",
                                fontSize: "0.875rem",
                                backgroundColor: isDisabled ? "#f1f5f9" : "#ffffff",
                                cursor: isDisabled ? "not-allowed" : "text",
                                opacity: isDisabled ? 0.6 : 1,
                              }}
                            />
                                  )}
                                </>
                          )}
                        </td>
                        <td style={{ padding: "1rem" }}>
                              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                            <select
                                  value={qtConfig.questionType}
                                  onChange={(e) => handleUpdateQuestionTypeConfig(topicIndex, configIndex, "questionType", e.target.value)}
                              disabled={isDisabled || (isAptitude && !config.subTopic)}
                              style={{
                                    flex: 1,
                                padding: "0.5rem",
                                border: "1px solid #e2e8f0",
                                borderRadius: "0.5rem",
                                fontSize: "0.875rem",
                                backgroundColor: isDisabled ? "#f1f5f9" : "#ffffff",
                                cursor: (isDisabled || (isAptitude && !config.subTopic)) ? "not-allowed" : "pointer",
                                opacity: isDisabled ? 0.6 : 1,
                              }}
                            >
                                  {(isAptitude ? aptitudeQuestionTypes : (() => {
                                    // Filter out "coding" if topic doesn't support coding
                                    let availableTypes = QUESTION_TYPES;
                                    const topic = topicConfigs[topicIndex];
                                    if (topic && topic.coding_supported === false) {
                                      availableTypes = QUESTION_TYPES.filter(type => type !== "coding");
                                    }
                                    return availableTypes;
                                  })()).map((type) => (
                                <option key={type} value={type}>
                                  {type}
                                </option>
                              ))}
                            </select>
                                {!isDisabled && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => handleAddQuestionType(topicIndex)}
                                      title="Add another question type"
                                style={{
                                        background: "none",
                                  border: "1px solid #e2e8f0",
                                        color: "#10b981",
                                        cursor: "pointer",
                                        fontSize: "1.25rem",
                                        fontWeight: 600,
                                        width: "32px",
                                        height: "32px",
                                        borderRadius: "0.25rem",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        padding: 0,
                                      }}
                                    >
                                      +
                                    </button>
                                    {config.questionTypeConfigs.length > 1 && (
                                      <button
                                        type="button"
                                        onClick={() => handleRemoveQuestionType(topicIndex, configIndex)}
                                        title="Remove this question type"
                                        style={{
                                          background: "none",
                                          border: "1px solid #e2e8f0",
                                          color: "#ef4444",
                                          cursor: "pointer",
                                          fontSize: "1.25rem",
                                          fontWeight: 600,
                                          width: "32px",
                                          height: "32px",
                                          borderRadius: "0.25rem",
                                          display: "flex",
                                          alignItems: "center",
                                          justifyContent: "center",
                                          padding: 0,
                                        }}
                                      >
                                        −
                                      </button>
                                    )}
                                  </>
                            )}
                          </div>
                        </td>
                        <td style={{ padding: "1rem" }}>
                          <select
                                value={qtConfig.difficulty}
                                onChange={(e) => handleUpdateQuestionTypeConfig(topicIndex, configIndex, "difficulty", e.target.value)}
                            disabled={false}
                            style={{
                              width: "100%",
                              padding: "0.5rem",
                              border: "1px solid #e2e8f0",
                              borderRadius: "0.5rem",
                              fontSize: "0.875rem",
                              backgroundColor: "#ffffff",
                              cursor: "pointer",
                              opacity: 1,
                            }}
                          >
                            {DIFFICULTY_LEVELS.map((level) => (
                              <option key={level} value={level}>
                                {level}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td style={{ padding: "1rem" }}>
                          <input
                            type="number"
                            min="1"
                            max="20"
                                value={qtConfig.numQuestions}
                            onChange={(e) =>
                                  handleUpdateQuestionTypeConfig(topicIndex, configIndex, "numQuestions", parseInt(e.target.value) || 1)
                            }
                            disabled={false}
                            style={{
                              width: "100%",
                              padding: "0.5rem",
                              border: "1px solid #e2e8f0",
                              borderRadius: "0.5rem",
                              fontSize: "0.875rem",
                              backgroundColor: "#ffffff",
                              cursor: "text",
                              opacity: 1,
                            }}
                          />
                        </td>
                        <td style={{ padding: "1rem" }}>
                              {isFirstRow && (
                          <button
                            type="button"
                                  onClick={() => handleRemoveTopic(topicIndex)}
                            disabled={false}
                                  title="Remove entire topic"
                            style={{
                              background: "none",
                              border: "none",
                              color: "#ef4444",
                              cursor: "pointer",
                              fontSize: "0.875rem",
                              padding: "0.25rem 0.5rem",
                              opacity: 1,
                            }}
                          >
                                  Remove Topic
                          </button>
                              )}
                        </td>
                      </tr>
                      );
                      });
                    })) : (
                      <tr>
                        <td colSpan={5} style={{ padding: "2rem", textAlign: "center", color: "#64748b" }}>
                          No topics configured yet. Please generate topics from Station 1 or add a custom topic below.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Custom Topic Input */}
              <div style={{ marginTop: "2rem", padding: "1.5rem", backgroundColor: "#f8fafc", borderRadius: "0.75rem", border: "1px solid #e2e8f0" }}>
                <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1e293b" }}>
                  Add Custom Topic
                </label>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <input
                    type="text"
                    value={customTopicInput}
                    onChange={(e) => setCustomTopicInput(e.target.value)}
                    onKeyPress={(e) => {
                      if (e.key === "Enter") {
                        handleAddCustomTopic();
                      }
                    }}
                    placeholder="Enter custom topic name"
                    disabled={loading}
                    style={{
                      flex: 1,
                      padding: "0.75rem",
                      border: "1px solid #e2e8f0",
                      borderRadius: "0.5rem",
                      fontSize: "0.875rem",
                      backgroundColor: "#ffffff",
                      cursor: "text",
                      opacity: loading ? 0.6 : 1,
                    }}
                  />
                    <button
                      type="button"
                    onClick={handleAddCustomTopic}
                    disabled={loading || !customTopicInput.trim()}
                    style={{
                      padding: "0.75rem 1.5rem",
                      background: loading || !customTopicInput.trim() ? "#94a3b8" : "#10b981",
                      border: "none",
                      color: "#ffffff",
                      cursor: loading || !customTopicInput.trim() ? "not-allowed" : "pointer",
                      fontSize: "0.875rem",
                      fontWeight: 500,
                      borderRadius: "0.5rem",
                    }}
                  >
                    Add Topic
                  </button>
                </div>
              </div>

              {/* Reset and Regenerate Buttons */}
              <div style={{ display: "flex", gap: "1rem", marginTop: "1.5rem" }}>
                <button
                  type="button"
                  onClick={handleResetTopics}
                  disabled={originalTopicConfigsRef.current.length === 0}
                      className="btn-secondary"
                  style={{ flex: 1, opacity: originalTopicConfigsRef.current.length === 0 ? 0.5 : 1 }}
                    >
                  Reset
                    </button>
                    <button
                      type="button"
                  onClick={handleRegenerateAllTopics}
                  disabled={loading || !assessmentId}
                  className="btn-secondary"
                  style={{ flex: 1, opacity: (loading || !assessmentId) ? 0.5 : 1 }}
                >
                  {loading ? "Regenerating..." : "Regenerate Topics"}
                    </button>
              </div>

              <div style={{ display: "flex", gap: "1rem", marginTop: "2rem" }}>
                    <button
                      type="button"
                  onClick={() => setCurrentStation(1)}
                      className="btn-secondary"
                      style={{ flex: 1 }}
                    >
                      Back
                    </button>
                    <button
                      type="button"
                    onClick={() => setCurrentStation(3)}
                      className="btn-primary"
                      style={{ flex: 1 }}
                    >
                    Next
                    </button>
              </div>
            </div>
          )}

          {/* Station 3: Review Questions */}
          {currentStation === 3 && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                <div style={{ flex: 1 }}>
              <h1 style={{ marginBottom: "0.5rem", fontSize: "2rem", color: "#1a1625", fontWeight: 700 }}>
                Review Questions
              </h1>
              <p style={{ color: "#6b6678", marginBottom: "2rem", fontSize: "1rem" }}>
                Review questions grouped by type and set time for each question type
              </p>
                </div>
                <button
                  type="button"
                  onClick={handleBackToDashboard}
                  className="btn-secondary"
                  style={{ 
                    marginLeft: "1rem",
                    whiteSpace: "nowrap",
                    padding: "0.75rem 1.5rem",
                    fontSize: "0.875rem"
                  }}
                >
                  Back to Dashboard
                </button>
              </div>

              {/* Toggle for Per-Section Timers */}
              <div style={{ 
                marginBottom: "2rem", 
                padding: "1.5rem", 
                backgroundColor: "#f8fafc", 
                borderRadius: "0.75rem", 
                border: "2px solid #e2e8f0" 
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
                  <div>
                    <h3 style={{ margin: 0, marginBottom: "0.5rem", fontSize: "1.125rem", color: "#1a1625", fontWeight: 600 }}>
                      Timer Settings
                    </h3>
                    <p style={{ margin: 0, fontSize: "0.875rem", color: "#64748b" }}>
                      {enablePerSectionTimers 
                        ? "Each question type will have its own timer. Sections will lock when their timer expires."
                        : "Only the overall assessment schedule time will apply. No per-section timers."}
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                    <button
                      type="button"
                      onClick={() => setEnablePerSectionTimers(true)}
                      style={{
                        padding: "0.75rem 1.5rem",
                        border: `2px solid ${enablePerSectionTimers ? "#10b981" : "#e2e8f0"}`,
                        borderRadius: "0.5rem",
                        backgroundColor: enablePerSectionTimers ? "#10b981" : "#ffffff",
                        color: enablePerSectionTimers ? "#ffffff" : "#64748b",
                        fontWeight: 600,
                        cursor: "pointer",
                        fontSize: "0.875rem",
                        transition: "all 0.2s",
                      }}
                    >
                      Enable Per-Section Timers
                    </button>
                    <button
                      type="button"
                      onClick={() => setEnablePerSectionTimers(false)}
                      style={{
                        padding: "0.75rem 1.5rem",
                        border: `2px solid ${!enablePerSectionTimers ? "#3b82f6" : "#e2e8f0"}`,
                        borderRadius: "0.5rem",
                        backgroundColor: !enablePerSectionTimers ? "#3b82f6" : "#ffffff",
                        color: !enablePerSectionTimers ? "#ffffff" : "#64748b",
                        fontWeight: 600,
                        cursor: "pointer",
                        fontSize: "0.875rem",
                        transition: "all 0.2s",
                      }}
                    >
                      Use Schedule Time Only
                    </button>
                  </div>
                </div>
              </div>

              {questions.length === 0 && previewQuestions.length === 0 ? (
                <div style={{ textAlign: "center", padding: "3rem", color: "#64748b" }}>
                  <p>No questions generated yet.</p>
                  <p style={{ fontSize: "0.875rem", marginTop: "0.5rem" }}>
                    Generate questions from the Configure Topics page or use Preview Questions.
                  </p>
                </div>
              ) : (
                <div style={{ marginBottom: "2rem" }}>
                  {/* Group questions by type */}
                  {(() => {
                    const questionsByType: { [key: string]: any[] } = {};
                    questions.forEach((q) => {
                      const type = q.type || "Other";
                      if (!questionsByType[type]) {
                        questionsByType[type] = [];
                      }
                      questionsByType[type].push(q);
                    });

                    // Initialize questionTypeTimes if not set
                    Object.keys(questionsByType).forEach((type) => {
                      if (!questionTypeTimes[type]) {
                        setQuestionTypeTimes((prev) => ({
                          ...prev,
                          [type]: 10, // Default 10 minutes per type
                        }));
                      }
                    });

                    return Object.entries(questionsByType).map(([questionType, typeQuestions]) => {
                      const typeTime = questionTypeTimes[questionType] || 10;
                      const totalScore = typeQuestions.reduce((sum, q) => sum + (q.score || 5), 0);
                      let questionIndex = 0;
                      questions.forEach((q) => {
                        if (q.type === questionType) {
                          q._displayIndex = questionIndex++;
                        }
                      });

                      return (
                        <div key={questionType} style={{ marginBottom: "2rem" }}>
                          <div style={{ 
                            display: "flex", 
                            justifyContent: "space-between", 
                            alignItems: "center",
                            marginBottom: "1rem",
                            padding: "1rem",
                            backgroundColor: "#f8fafc",
                            borderRadius: "0.5rem",
                            border: "1px solid #e2e8f0"
                          }}>
                            <div>
                              <h3 style={{ margin: 0, fontSize: "1.25rem", color: "#1a1625", fontWeight: 700 }}>
                                {questionType} Questions
                              </h3>
                              <p style={{ margin: "0.25rem 0 0 0", fontSize: "0.875rem", color: "#64748b" }}>
                                {typeQuestions.length} question{typeQuestions.length !== 1 ? "s" : ""} • Total Score: {totalScore} points
                              </p>
                            </div>
                            {enablePerSectionTimers && (
                              <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem", color: "#1e293b", fontWeight: 600 }}>
                                  Time (minutes):
                                  <input
                                    type="number"
                                    min="1"
                                    value={typeTime}
                                    onChange={(e) => {
                                      setQuestionTypeTimes((prev) => ({
                                        ...prev,
                                        [questionType]: parseInt(e.target.value) || 10,
                                      }));
                                    }}
                                    style={{
                                      width: "80px",
                                      padding: "0.5rem",
                                      border: "1px solid #e2e8f0",
                                      borderRadius: "0.5rem",
                                      fontSize: "0.875rem",
                                    }}
                                  />
                                </label>
                              </div>
                            )}
                          </div>

                          {/* Questions Table for this type */}
                          <div style={{ overflowX: "auto", marginBottom: "1.5rem" }}>
                            <table style={{ width: "100%", borderCollapse: "collapse", backgroundColor: "#ffffff", borderRadius: "0.5rem", overflow: "hidden", border: "1px solid #e2e8f0" }}>
                              <thead>
                                <tr style={{ backgroundColor: "#f8fafc" }}>
                                  <th style={{ padding: "1rem", textAlign: "left", borderBottom: "2px solid #e2e8f0", fontWeight: 600, color: "#1e293b" }}>
                                    Question
                                  </th>
                                  <th style={{ padding: "1rem", textAlign: "left", borderBottom: "2px solid #e2e8f0", fontWeight: 600, color: "#1e293b", width: "120px" }}>
                                    Score (points)
                                  </th>
                                  <th style={{ padding: "1rem", textAlign: "center", borderBottom: "2px solid #e2e8f0", fontWeight: 600, color: "#1e293b", width: "60px" }}>
                                    Action
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {typeQuestions.map((question, typeIndex) => {
                                  const globalIndex = questions.findIndex((q) => q === question);
                                  return (
                                    <tr key={globalIndex} style={{ borderBottom: "1px solid #e2e8f0" }}>
                                      <td style={{ padding: "1rem", maxWidth: "500px" }}>
                                        <div style={{ marginBottom: "0.5rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
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
                                            Q{globalIndex + 1}
                                          </span>
                                          <span
                                            style={{
                                              backgroundColor: "#fef3c7",
                                              color: "#92400e",
                                              padding: "0.25rem 0.75rem",
                                              borderRadius: "9999px",
                                              fontSize: "0.75rem",
                                              fontWeight: 500,
                                            }}
                                          >
                                            {question.difficulty}
                                          </span>
                                        </div>
                                        <span style={{ fontSize: "0.875rem", color: "#64748b", marginTop: "0.25rem", display: "block" }}>
                                          {question.topic || "Unknown Topic"}
                                        </span>
                                      </td>
                                      <td style={{ padding: "1rem" }}>
                                        <input
                                          type="number"
                                          min="1"
                                          value={question.score || 5}
                                          onChange={(e) => {
                                            const updated = [...questions];
                                            updated[globalIndex] = { ...updated[globalIndex], score: parseInt(e.target.value) || 5 };
                                            setQuestions(updated);
                                          }}
                                          style={{
                                            width: "100%",
                                            padding: "0.5rem",
                                            border: "1px solid #e2e8f0",
                                            borderRadius: "0.5rem",
                                            fontSize: "0.875rem",
                                          }}
                                        />
                                      </td>
                                      <td style={{ padding: "1rem", textAlign: "center" }}>
                                        <button
                                          type="button"
                                          onClick={() => handleRemoveQuestion(globalIndex)}
                                          style={{
                                            background: "none",
                                            border: "none",
                                            color: "#ef4444",
                                            cursor: "pointer",
                                            fontSize: "1.25rem",
                                            padding: "0.25rem 0.5rem",
                                            borderRadius: "0.25rem",
                                            transition: "background-color 0.2s",
                                          }}
                                          onMouseEnter={(e) => {
                                            e.currentTarget.style.backgroundColor = "#fef2f2";
                                          }}
                                          onMouseLeave={(e) => {
                                            e.currentTarget.style.backgroundColor = "transparent";
                                          }}
                                          title="Remove question"
                                        >
                                          ×
                                        </button>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      );
                    });
                  })()}
                  
                  {/* Total Summary */}
                  <div style={{ 
                    display: "flex", 
                    justifyContent: "space-between", 
                    alignItems: "center",
                    padding: "1rem 1.5rem",
                    backgroundColor: "#f8fafc",
                    borderRadius: "0.5rem",
                    border: "1px solid #e2e8f0",
                    marginTop: "1rem"
                  }}>
                    <div>
                      <span style={{ color: "#64748b", fontSize: "0.875rem", marginRight: "0.5rem" }}>Total Score:</span>
                      <span style={{ color: "#1e293b", fontSize: "1.125rem", fontWeight: 700 }}>
                        {questions.reduce((sum, q) => sum + (q.score || 5), 0)} points
                      </span>
                    </div>
                    {enablePerSectionTimers && (
                      <div>
                        <span style={{ color: "#64748b", fontSize: "0.875rem", marginRight: "0.5rem" }}>Total Time (All Types):</span>
                        <span style={{ color: "#1e293b", fontSize: "1.125rem", fontWeight: 700 }}>
                          {Object.values(questionTypeTimes).reduce((sum, time) => sum + time, 0)} minutes
                        </span>
                      </div>
                    )}
                    {!enablePerSectionTimers && (
                      <div>
                        <span style={{ color: "#64748b", fontSize: "0.875rem", marginRight: "0.5rem" }}>Timer Mode:</span>
                        <span style={{ color: "#3b82f6", fontSize: "1.125rem", fontWeight: 700 }}>
                          Schedule Time Only
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div style={{ marginTop: "2rem", paddingTop: "2rem", borderTop: "2px solid #e2e8f0" }}>
                <h3 style={{ marginBottom: "1.5rem", fontSize: "1.25rem", color: "#0f172a" }}>Finalize Assessment</h3>
                <div style={{ marginBottom: "1.5rem" }}>
                  <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1e293b" }}>
                    Pass Percentage (%)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={passPercentage}
                    onChange={(e) => setPassPercentage(parseFloat(e.target.value) || 0)}
                    placeholder="Enter pass percentage (e.g., 75)"
                    style={{
                      width: "100%",
                      padding: "0.75rem",
                      border: "1px solid #e2e8f0",
                      borderRadius: "0.5rem",
                      fontSize: "1rem",
                    }}
                  />
                  <p style={{ fontSize: "0.875rem", color: "#64748b", marginTop: "0.5rem" }}>
                    Candidates need to score at least {passPercentage}% to pass the assessment.
                  </p>
                </div>
                <div style={{ display: "flex", gap: "1rem" }}>
                  <button
                    type="button"
                    onClick={() => {
                      setHasVisitedReviewStation(true);
                      setCurrentStation(2);
                    }}
                    className="btn-secondary"
                    style={{ flex: 1 }}
                  >
                    Back
                  </button>
                  {isEditMode ? (
                    <button
                      type="button"
                      onClick={() => setCurrentStation(4)}
                      className="btn-primary"
                      style={{ flex: 1 }}
                    >
                      Next
                    </button>
                  ) : (
                  <button
                    type="button"
                    onClick={handleFinalize}
                    className="btn-primary"
                    disabled={loading}
                    style={{ flex: 1 }}
                  >
                    {loading ? "Finalizing..." : "Finalize Assessment"}
                  </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Station 4: Schedule Exam */}
          {currentStation === 4 && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                <div style={{ flex: 1 }}>
              <h1 style={{ marginBottom: "0.5rem", fontSize: "2rem", color: "#1a1625", fontWeight: 700 }}>
                Schedule Exam
              </h1>
              <p style={{ color: "#6b6678", marginBottom: "2rem", fontSize: "1rem" }}>
                Set the start and end time for the assessment (Indian Standard Time - IST)
              </p>
                </div>
                <button
                  type="button"
                  onClick={handleBackToDashboard}
                  className="btn-secondary"
                  style={{ 
                    marginLeft: "1rem",
                    whiteSpace: "nowrap",
                    padding: "0.75rem 1.5rem",
                    fontSize: "0.875rem"
                  }}
                >
                  Back to Dashboard
                </button>
              </div>

              <div style={{ marginBottom: "2rem" }}>
                <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1e293b" }}>
                  Start Time (IST) *
                </label>
                <input
                  type="datetime-local"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  required
                  style={{
                    width: "100%",
                    padding: "0.75rem",
                    border: "1px solid #e2e8f0",
                    borderRadius: "0.5rem",
                    fontSize: "1rem",
                  }}
                />
                <p style={{ fontSize: "0.875rem", color: "#64748b", marginTop: "0.5rem" }}>
                  Indian Standard Time (IST) - UTC+5:30
                </p>
              </div>

              <div style={{ marginBottom: "2rem" }}>
                <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1e293b" }}>
                  End Time (IST) *
                </label>
                <input
                  type="datetime-local"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  required
                  style={{
                    width: "100%",
                    padding: "0.75rem",
                    border: `1px solid ${startTime && endTime && new Date(endTime) <= new Date(startTime) ? "#ef4444" : "#e2e8f0"}`,
                    borderRadius: "0.5rem",
                    fontSize: "1rem",
                  }}
                />
                <p style={{ fontSize: "0.875rem", color: "#64748b", marginTop: "0.5rem" }}>
                  Indian Standard Time (IST) - UTC+5:30
                </p>
                {startTime && endTime && new Date(endTime) <= new Date(startTime) && (
                  <p style={{ fontSize: "0.875rem", color: "#dc2626", marginTop: "0.5rem", fontWeight: 600 }}>
                    ⚠️ Please choose an end time greater than the start time
                  </p>
                )}
              </div>

              {/* Error Message for Invalid Time Range */}
              {startTime && endTime && new Date(endTime) <= new Date(startTime) && (
                <div style={{ 
                  marginBottom: "1.5rem",
                  padding: "1rem",
                  backgroundColor: "#fef2f2",
                  border: "2px solid #ef4444",
                  borderRadius: "0.5rem"
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
                    <span style={{ fontSize: "1.25rem" }}>⚠️</span>
                    <strong style={{ color: "#dc2626" }}>
                      Invalid Time Range
                    </strong>
                  </div>
                  <div style={{ fontSize: "0.875rem", color: "#64748b", marginLeft: "1.75rem" }}>
                    <div style={{ color: "#dc2626", fontWeight: 600 }}>
                      Please choose an end time that is greater than the start time.
                    </div>
                  </div>
                </div>
              )}

              {/* Validation Message - Only show if per-section timers are enabled and time range is valid */}
              {startTime && endTime && new Date(endTime) > new Date(startTime) && enablePerSectionTimers && (() => {
                const scheduledDuration = (new Date(endTime).getTime() - new Date(startTime).getTime()) / (1000 * 60); // in minutes
                const totalTimeFromReview = Object.values(questionTypeTimes).reduce((sum, time) => sum + time, 0);
                const isValid = scheduledDuration >= totalTimeFromReview;
                
                return (
                  <div style={{ 
                    marginBottom: "1.5rem",
                    padding: "1rem",
                    backgroundColor: isValid ? "#f0fdf4" : "#fef2f2",
                    border: `2px solid ${isValid ? "#10b981" : "#ef4444"}`,
                    borderRadius: "0.5rem"
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
                      <span style={{ fontSize: "1.25rem" }}>{isValid ? "✓" : "⚠️"}</span>
                      <strong style={{ color: isValid ? "#059669" : "#dc2626" }}>
                        {isValid ? "Schedule Duration is Valid" : "Schedule Duration is Too Short"}
                      </strong>
                    </div>
                    <div style={{ fontSize: "0.875rem", color: "#64748b", marginLeft: "1.75rem" }}>
                      <div>Total time from Review Station: <strong>{totalTimeFromReview} minutes</strong></div>
                      <div>Scheduled duration: <strong>{Math.round(scheduledDuration)} minutes</strong></div>
                      {!isValid && (
                        <div style={{ color: "#dc2626", marginTop: "0.5rem", fontWeight: 600 }}>
                          ⚠️ Scheduled duration must be greater than or equal to {totalTimeFromReview} minutes
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
              
              {/* Info Message when per-section timers are disabled and time range is valid */}
              {startTime && endTime && new Date(endTime) > new Date(startTime) && !enablePerSectionTimers && (() => {
                const scheduledDuration = (new Date(endTime).getTime() - new Date(startTime).getTime()) / (1000 * 60); // in minutes
                
                return (
                  <div style={{ 
                    marginBottom: "1.5rem",
                    padding: "1rem",
                    backgroundColor: "#f0f9ff",
                    border: "2px solid #3b82f6",
                    borderRadius: "0.5rem"
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
                      <span style={{ fontSize: "1.25rem" }}>ℹ️</span>
                      <strong style={{ color: "#1e40af" }}>
                        Schedule Time Only Mode
                      </strong>
                    </div>
                    <div style={{ fontSize: "0.875rem", color: "#64748b", marginLeft: "1.75rem" }}>
                      <div>Scheduled duration: <strong>{Math.round(scheduledDuration)} minutes</strong></div>
                      <div style={{ marginTop: "0.5rem" }}>
                        Candidates will have the full scheduled time to complete the entire assessment. No per-section timers will be applied.
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div style={{ display: "flex", gap: "1rem", marginTop: "2rem" }}>
                <button
                  type="button"
                  onClick={() => setCurrentStation(3)}
                  className="btn-secondary"
                  style={{ flex: 1 }}
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!startTime || !endTime) {
                      setError("Please set both start and end time");
                      return;
                    }
                    if (new Date(startTime) >= new Date(endTime)) {
                      setError("End time must be after start time");
                      return;
                    }
                    
                    // Validate scheduled duration >= total time from Review Station (only if per-section timers are enabled)
                    if (enablePerSectionTimers) {
                      const scheduledDuration = (new Date(endTime).getTime() - new Date(startTime).getTime()) / (1000 * 60); // in minutes
                      const totalTimeFromReview = Object.values(questionTypeTimes).reduce((sum, time) => sum + time, 0);
                      
                      if (scheduledDuration < totalTimeFromReview) {
                        setError(`Scheduled duration (${Math.round(scheduledDuration)} minutes) must be greater than or equal to the total time set in Review Station (${totalTimeFromReview} minutes)`);
                        return;
                      }
                    }
                    
                    setError(null);
                    setCurrentStation(5);
                  }}
                  className="btn-primary"
                  style={{ flex: 1 }}
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {/* Station 5: Add Candidates */}
          {currentStation === 5 && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                <div style={{ flex: 1 }}>
              <h1 style={{ marginBottom: "0.5rem", fontSize: "2rem", color: "#1a1625", fontWeight: 700 }}>
                Add Candidates
              </h1>
              <p style={{ color: "#6b6678", marginBottom: "2rem", fontSize: "1rem" }}>
                Add candidates who will take this assessment. A unique URL will be generated for all candidates.
              </p>
                </div>
                <button
                  type="button"
                  onClick={handleBackToDashboard}
                  className="btn-secondary"
                  style={{ 
                    marginLeft: "1rem",
                    whiteSpace: "nowrap",
                    padding: "0.75rem 1.5rem",
                    fontSize: "0.875rem"
                  }}
                >
                  Back to Dashboard
                </button>
              </div>

              <div style={{ marginBottom: "2rem" }}>
                <label style={{ display: "block", marginBottom: "0.75rem", fontWeight: 600, color: "#1e293b" }}>
                  Bulk Upload (CSV)
                </label>
                <div style={{ 
                  marginBottom: "1.5rem", 
                  padding: "1rem", 
                  backgroundColor: "#f8fafc", 
                  borderRadius: "0.5rem", 
                  border: "1px solid #e2e8f0" 
                }}>
                  <p style={{ margin: "0 0 0.75rem 0", fontSize: "0.875rem", color: "#64748b" }}>
                    Upload a CSV file with columns: <strong>name</strong> and <strong>email</strong>
                  </p>
                  <input
                    type="file"
                    accept=".csv"
                    onChange={handleCsvUpload}
                    disabled={uploadingCsv}
                    style={{ display: "none" }}
                    id="csv-upload-input"
                  />
                  <label
                    htmlFor="csv-upload-input"
                    style={{
                      display: "inline-block",
                      padding: "0.75rem 1.5rem",
                      backgroundColor: uploadingCsv ? "#94a3b8" : "#3b82f6",
                      color: "#ffffff",
                      borderRadius: "0.5rem",
                      cursor: uploadingCsv ? "not-allowed" : "pointer",
                      fontSize: "0.875rem",
                      fontWeight: 600,
                      transition: "background-color 0.2s",
                    }}
                  >
                    {uploadingCsv ? "Uploading..." : "Choose CSV File"}
                  </label>
                  {uploadingCsv && (
                    <span style={{ marginLeft: "0.75rem", fontSize: "0.875rem", color: "#64748b" }}>
                      Processing CSV file...
                    </span>
                  )}
                </div>

                <label style={{ display: "block", marginBottom: "0.75rem", fontWeight: 600, color: "#1e293b" }}>
                  Add Candidate (Manual)
                </label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: "0.5rem", marginBottom: "1rem" }}>
                  <input
                    type="email"
                    value={candidateEmail}
                    onChange={(e) => setCandidateEmail(e.target.value)}
                    onKeyPress={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddCandidate();
                      }
                    }}
                    placeholder="Candidate Email"
                    style={{
                      padding: "0.75rem",
                      border: "1px solid #e2e8f0",
                      borderRadius: "0.5rem",
                      fontSize: "1rem",
                    }}
                  />
                  <input
                    type="text"
                    value={candidateName}
                    onChange={(e) => setCandidateName(e.target.value)}
                    onKeyPress={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddCandidate();
                      }
                    }}
                    placeholder="Candidate Name"
                    style={{
                      padding: "0.75rem",
                      border: "1px solid #e2e8f0",
                      borderRadius: "0.5rem",
                      fontSize: "1rem",
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleAddCandidate}
                    className="btn-secondary"
                    disabled={!candidateEmail.trim() || !candidateName.trim()}
                    style={{ marginTop: 0, whiteSpace: "nowrap", padding: "0.75rem 1.5rem" }}
                  >
                    Add
                  </button>
                </div>
              </div>

              {candidates.length > 0 && (
                <div style={{ marginBottom: "2rem" }}>
                  <label style={{ display: "block", marginBottom: "0.75rem", fontWeight: 600, color: "#1e293b" }}>
                    Added Candidates ({candidates.length})
                  </label>
                  <div style={{ border: "1px solid #e2e8f0", borderRadius: "0.75rem", overflow: "hidden" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ backgroundColor: "#f8fafc" }}>
                          <th style={{ padding: "1rem", textAlign: "left", borderBottom: "1px solid #e2e8f0", fontWeight: 600, color: "#1e293b" }}>
                            Email
                          </th>
                          <th style={{ padding: "1rem", textAlign: "left", borderBottom: "1px solid #e2e8f0", fontWeight: 600, color: "#1e293b" }}>
                            Name
                          </th>
                          <th style={{ padding: "1rem", textAlign: "left", borderBottom: "1px solid #e2e8f0", fontWeight: 600, color: "#1e293b" }}>
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {candidates.map((candidate, index) => (
                          <tr key={index} style={{ borderBottom: "1px solid #e2e8f0" }}>
                            <td style={{ padding: "1rem" }}>{candidate.email}</td>
                            <td style={{ padding: "1rem" }}>{candidate.name}</td>
                            <td style={{ padding: "1rem" }}>
                              <button
                                type="button"
                                onClick={() => handleRemoveCandidate(candidate.email)}
                                style={{
                                  background: "none",
                                  border: "none",
                                  color: "#ef4444",
                                  cursor: "pointer",
                                  fontSize: "0.875rem",
                                }}
                              >
                                Remove
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {!assessmentUrl && (
                <div style={{ marginBottom: "2rem" }}>
                  <button
                    type="button"
                    onClick={handleGenerateUrl}
                    className="btn-primary"
                    disabled={candidates.length === 0}
                    style={{ width: "100%" }}
                  >
                    Generate Assessment URL
                  </button>
                </div>
              )}

              {assessmentUrl && (
                <div style={{ marginBottom: "2rem", padding: "1.5rem", backgroundColor: "#f8fafc", borderRadius: "0.75rem", border: "1px solid #e2e8f0" }}>
                  <label style={{ display: "block", marginBottom: "0.75rem", fontWeight: 600, color: "#1e293b" }}>
                    Assessment URL
                  </label>
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <input
                      type="text"
                      value={assessmentUrl}
                      readOnly
                      style={{
                        flex: 1,
                        padding: "0.75rem",
                        border: "1px solid #e2e8f0",
                        borderRadius: "0.5rem",
                        fontSize: "1rem",
                        backgroundColor: "#ffffff",
                      }}
                    />
                    <button
                      type="button"
                      onClick={handleCopyUrl}
                      className="btn-secondary"
                      style={{ marginTop: 0, whiteSpace: "nowrap", padding: "0.75rem 1.5rem" }}
                    >
                      Copy URL
                    </button>
                  </div>
                  <p style={{ fontSize: "0.875rem", color: "#64748b", marginTop: "0.5rem" }}>
                    Share this URL with all candidates. They will use it to access the assessment.
                  </p>
                </div>
              )}

              <div style={{ display: "flex", gap: "1rem", marginTop: "2rem" }}>
                <button
                  type="button"
                  onClick={() => setCurrentStation(4)}
                  className="btn-secondary"
                  style={{ flex: 1 }}
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (!assessmentUrl) {
                      setError("Please generate the assessment URL first");
                      return;
                    }
                    if (candidates.length === 0) {
                      setError("Please add at least one candidate");
                      return;
                    }
                    setError(null);
                    // Save and redirect to dashboard
                    // Don't regenerate URL if it already exists to preserve the copied URL
                    // Since we already checked assessmentUrl exists above, just redirect
                    try {
                      router.push("/dashboard");
                    } catch (err: any) {
                      setError("Failed to redirect. Please try again.");
                    }
                  }}
                  className="btn-primary"
                  disabled={!assessmentUrl || candidates.length === 0}
                  style={{ flex: 1 }}
                >
                  Complete
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Full-screen Preview Questions Modal */}
      {showPreviewModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.8)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "2rem",
          }}
          onClick={(e) => {
            // Close modal if clicking outside (generation continues in background)
            if (e.target === e.currentTarget) {
              setShowPreviewModal(false);
            }
          }}
        >
          <div
            style={{
              backgroundColor: "#ffffff",
              borderRadius: "1rem",
              width: "100%",
              maxWidth: "900px",
              maxHeight: "90vh",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div
              style={{
                padding: "1.5rem",
                borderBottom: "1px solid #e2e8f0",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <h2 style={{ margin: 0, fontSize: "1.5rem", color: "#1a1625", fontWeight: 700 }}>
                Preview Questions
              </h2>
              <button
                type="button"
                onClick={() => {
                  // Close modal but keep generation running in background
                  setShowPreviewModal(false);
                  // Don't clear preview questions - they're still being generated
                }}
                style={{
                  background: "none",
                  border: "none",
                  fontSize: "1.5rem",
                  color: "#64748b",
                  cursor: "pointer",
                  padding: "0.25rem 0.5rem",
                  lineHeight: 1,
                }}
                title={previewGenerating ? "Close (generation continues in background)" : "Close"}
              >
                ×
              </button>
            </div>

            {/* Content */}
            <div style={{ flex: 1, overflow: "auto", padding: "1.5rem" }}>
              {previewGenerating && previewQuestions.length === 0 ? (
                // Loading state
                <div style={{ textAlign: "center", padding: "3rem" }}>
                  <div
                    style={{
                      width: "60px",
                      height: "60px",
                      border: "4px solid #e2e8f0",
                      borderTop: "4px solid #3b82f6",
                      borderRadius: "50%",
                      animation: "spin 1s linear infinite",
                      margin: "0 auto 1.5rem",
                    }}
                  />
                  <h3 style={{ margin: 0, marginBottom: "0.5rem", color: "#1a1625", fontSize: "1.25rem" }}>
                    Generating Questions...
                  </h3>
                  <p style={{ margin: 0, color: "#64748b" }}>
                    {previewProgress.current > 0
                      ? `Generated ${previewProgress.current} of ${previewProgress.total} questions`
                      : "Starting generation..."}
                  </p>
                </div>
              ) : previewQuestions.length > 0 || questions.length > 0 ? (
                // Show current question (use previewQuestions if available, otherwise questions)
                <div>
                  {(() => {
                    const questionsToShow = previewQuestions.length > 0 ? previewQuestions : questions;
                    const totalQuestions = questionsToShow.length;
                    // Ensure index is within bounds (clamp to valid range)
                    const safeIndex = totalQuestions > 0 ? Math.min(Math.max(0, currentPreviewIndex), totalQuestions - 1) : 0;
                    const currentQuestion = questionsToShow[safeIndex];
                    
                    // Debug logging with question details
                    console.log(`[Preview] Rendering question: index=${currentPreviewIndex}, safeIndex=${safeIndex}, total=${totalQuestions}, hasQuestion=${!!currentQuestion}`);
                    if (currentQuestion) {
                      console.log(`[Preview] Question details: topic=${currentQuestion.topic}, type=${currentQuestion.type}, questionText=${currentQuestion.questionText?.substring(0, 50) || currentQuestion.question?.substring(0, 50) || 'N/A'}...`);
                    }
                    console.log(`[Preview] All questions in array:`, questionsToShow.map((q: any, idx: number) => ({
                      index: idx,
                      topic: q.topic,
                      type: q.type,
                      questionPreview: q.questionText?.substring(0, 30) || q.question?.substring(0, 30) || 'N/A'
                    })));
                    
                    return (
                      <>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            marginBottom: "1rem",
                            paddingBottom: "1rem",
                            borderBottom: "1px solid #e2e8f0",
                          }}
                        >
                          <div>
                            <span style={{ fontSize: "0.875rem", color: "#64748b" }}>
                              Question {safeIndex + 1} of {totalQuestions}
                            </span>
                            {previewGenerating && (
                              <span style={{ fontSize: "0.875rem", color: "#3b82f6", marginLeft: "1rem" }}>
                                Generating more...
                              </span>
                            )}
                          </div>
                          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                            <span style={{ fontSize: "0.875rem", color: "#64748b" }}>
                              {currentQuestion?.topic || "Unknown Topic"} -{" "}
                              {currentQuestion?.type || "Unknown Type"}
                            </span>
                            {currentQuestion?.difficulty && (
                        <span
                          style={{
                            fontSize: "0.75rem",
                            padding: "0.25rem 0.5rem",
                            backgroundColor: "#f1f5f9",
                            borderRadius: "0.25rem",
                            color: "#64748b",
                          }}
                        >
                          {currentQuestion.difficulty}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => handleEditQuestion(safeIndex)}
                        disabled={editingQuestionIndex !== null}
                        style={{
                          padding: "0.375rem 0.75rem",
                          background: "#3b82f6",
                          border: "none",
                          color: "#ffffff",
                          cursor: editingQuestionIndex !== null ? "not-allowed" : "pointer",
                          fontSize: "0.75rem",
                          fontWeight: 500,
                          borderRadius: "0.375rem",
                          opacity: editingQuestionIndex !== null ? 0.6 : 1,
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRegenerateQuestion(safeIndex)}
                        disabled={regeneratingQuestionIndex === safeIndex || previewGenerating}
                        style={{
                          padding: "0.375rem 0.75rem",
                          background: "#10b981",
                          border: "none",
                          color: "#ffffff",
                          cursor: (regeneratingQuestionIndex === safeIndex || previewGenerating) ? "not-allowed" : "pointer",
                          fontSize: "0.75rem",
                          fontWeight: 500,
                          borderRadius: "0.375rem",
                          opacity: (regeneratingQuestionIndex === safeIndex || previewGenerating) ? 0.6 : 1,
                        }}
                      >
                        {regeneratingQuestionIndex === safeIndex ? "Regenerating..." : "Regenerate"}
                      </button>
                    </div>
                  </div>

                  <div
                    key={`question-${safeIndex}-${totalQuestions}-${currentQuestion?._taskIndex ?? safeIndex}-${(currentQuestion?.questionText || currentQuestion?.question || '').substring(0, 20)}`}
                    style={{
                      backgroundColor: "#f8fafc",
                      padding: "1.5rem",
                      borderRadius: "0.5rem",
                      minHeight: "300px",
                    }}
                  >
                    {currentQuestion?.questionText || currentQuestion?.question ? (
                      <div
                        key={`question-content-${safeIndex}-${currentQuestion?._taskIndex ?? safeIndex}`}
                        style={{
                          fontSize: "1rem",
                          color: "#1e293b",
                          lineHeight: "1.6",
                          whiteSpace: "pre-wrap",
                        }}
                        dangerouslySetInnerHTML={{
                          __html: currentQuestion.questionText || currentQuestion.question || "",
                        }}
                      />
                    ) : (
                      <p style={{ color: "#94a3b8", margin: 0 }}>Question content not available</p>
                    )}

                    {/* Show options if MCQ */}
                    {currentQuestion?.type === "MCQ" &&
                      currentQuestion?.options && (
                        <div style={{ marginTop: "1.5rem" }}>
                          <h4 style={{ margin: "0 0 0.75rem 0", fontSize: "0.875rem", color: "#64748b" }}>
                            Options:
                          </h4>
                          <ul style={{ margin: 0, paddingLeft: "1.5rem", color: "#1e293b" }}>
                            {currentQuestion.options.map((opt: string, idx: number) => (
                              <li key={idx} style={{ marginBottom: "0.5rem" }}>
                                {opt}
                              </li>
                            ))}
                          </ul>
                          {currentQuestion?.correctAnswer && (
                            <div style={{ marginTop: "1rem", padding: "0.75rem", backgroundColor: "#dcfce7", borderRadius: "0.25rem" }}>
                              <strong style={{ color: "#166534" }}>Correct Answer: </strong>
                              <span style={{ color: "#166534" }}>
                                {currentQuestion.correctAnswer}
                              </span>
                            </div>
                          )}
                        </div>
                      )}

                    {/* Show test cases if coding */}
                    {currentQuestion?.type === "coding" &&
                      currentQuestion?.public_testcases && (
                        <div style={{ marginTop: "1.5rem" }}>
                          <h4 style={{ margin: "0 0 0.75rem 0", fontSize: "0.875rem", color: "#64748b" }}>
                            Test Cases:
                          </h4>
                          <div style={{ fontSize: "0.875rem", color: "#1e293b" }}>
                            {currentQuestion.public_testcases.length} test case(s) provided
                          </div>
                        </div>
                      )}
                  </div>
                      </>
                    );
                  })()}
                </div>
              ) : (
                // No questions yet
                <div style={{ textAlign: "center", padding: "3rem", color: "#64748b" }}>
                  <p>No questions generated yet.</p>
                </div>
              )}

            </div>

            {/* Footer with Navigation */}
            {(previewQuestions.length > 0 || questions.length > 0) && (
              <div
                style={{
                  padding: "1.5rem",
                  borderTop: "1px solid #e2e8f0",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                {(() => {
                  const questionsToShow = previewQuestions.length > 0 ? previewQuestions : questions;
                  const totalQuestions = questionsToShow.length;
                  // Calculate safe index for navigation buttons
                  const navSafeIndex = totalQuestions > 0 ? Math.min(Math.max(0, currentPreviewIndex), totalQuestions - 1) : 0;
                  
                  return (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setCurrentPreviewIndex((prevIndex) => {
                            const newIndex = Math.max(0, prevIndex - 1);
                            console.log(`[Preview] Previous clicked: ${prevIndex} -> ${newIndex} (total: ${totalQuestions})`);
                            return newIndex;
                          });
                        }}
                        disabled={navSafeIndex === 0}
                        className="btn-secondary"
                        style={{
                          marginTop: 0,
                          opacity: navSafeIndex === 0 ? 0.5 : 1,
                          cursor: navSafeIndex === 0 ? "not-allowed" : "pointer",
                        }}
                      >
                        Previous
                      </button>

                      <div style={{ fontSize: "0.875rem", color: "#64748b" }}>
                        {navSafeIndex + 1} / {totalQuestions}
                        {previewGenerating && " (generating...)"}
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setCurrentPreviewIndex((prevIndex) => {
                            const newIndex = Math.min(totalQuestions - 1, prevIndex + 1);
                            console.log(`[Preview] Next clicked: ${prevIndex} -> ${newIndex} (total: ${totalQuestions})`);
                            return newIndex;
                          });
                        }}
                        disabled={navSafeIndex >= totalQuestions - 1 && !previewGenerating}
                        className="btn-primary"
                        style={{
                          marginTop: 0,
                          opacity:
                            navSafeIndex >= totalQuestions - 1 && !previewGenerating ? 0.5 : 1,
                          cursor:
                            navSafeIndex >= totalQuestions - 1 && !previewGenerating
                              ? "not-allowed"
                              : "pointer",
                        }}
                      >
                        {navSafeIndex >= totalQuestions - 1 && previewGenerating
                          ? "Generating..."
                          : "Next"}
                      </button>
                    </>
                  );
                })()}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Edit Question Modal */}
      {editingQuestionIndex !== null && editingQuestion && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10000,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setEditingQuestionIndex(null);
              setEditingQuestion(null);
            }
          }}
        >
          <div
            style={{
              backgroundColor: "#ffffff",
              borderRadius: "0.75rem",
              padding: "2rem",
              maxWidth: "800px",
              width: "90%",
              maxHeight: "90vh",
              overflowY: "auto",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ marginBottom: "1.5rem", fontSize: "1.5rem", color: "#1a1625", fontWeight: 700 }}>
              Edit Question
            </h2>

            <div style={{ marginBottom: "1rem" }}>
              <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1e293b" }}>
                Question Text
              </label>
              <textarea
                value={editingQuestion.questionText || editingQuestion.question || ""}
                onChange={(e) =>
                  setEditingQuestion({ ...editingQuestion, questionText: e.target.value, question: e.target.value })
                }
                style={{
                  width: "100%",
                  minHeight: "150px",
                  padding: "0.75rem",
                  border: "1px solid #e2e8f0",
                  borderRadius: "0.5rem",
                  fontSize: "0.875rem",
                  fontFamily: "inherit",
                }}
              />
            </div>

            {editingQuestion.type === "MCQ" && (
              <>
                <div style={{ marginBottom: "1rem" }}>
                  <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1e293b" }}>
                    Options (one per line)
                  </label>
                  <textarea
                    value={(editingQuestion.options || []).join("\n")}
                    onChange={(e) =>
                      setEditingQuestion({
                        ...editingQuestion,
                        options: e.target.value.split("\n").filter((opt: string) => opt.trim()),
                      })
                    }
                    style={{
                      width: "100%",
                      minHeight: "100px",
                      padding: "0.75rem",
                      border: "1px solid #e2e8f0",
                      borderRadius: "0.5rem",
                      fontSize: "0.875rem",
                      fontFamily: "inherit",
                    }}
                  />
                </div>
                <div style={{ marginBottom: "1rem" }}>
                  <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1e293b" }}>
                    Correct Answer
                  </label>
                  <input
                    type="text"
                    value={editingQuestion.correctAnswer || ""}
                    onChange={(e) => setEditingQuestion({ ...editingQuestion, correctAnswer: e.target.value })}
                    style={{
                      width: "100%",
                      padding: "0.75rem",
                      border: "1px solid #e2e8f0",
                      borderRadius: "0.5rem",
                      fontSize: "0.875rem",
                    }}
                  />
                </div>
              </>
            )}

            {editingQuestion.type === "coding" && editingQuestion.public_testcases && (
              <div style={{ marginBottom: "1rem" }}>
                <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1e293b" }}>
                  Test Cases (JSON format)
                </label>
                <textarea
                  value={JSON.stringify(editingQuestion.public_testcases, null, 2)}
                  onChange={(e) => {
                    try {
                      const testCases = JSON.parse(e.target.value);
                      setEditingQuestion({ ...editingQuestion, public_testcases: testCases });
                    } catch (err) {
                      // Invalid JSON, but allow editing
                    }
                  }}
                  style={{
                    width: "100%",
                    minHeight: "150px",
                    padding: "0.75rem",
                    border: "1px solid #e2e8f0",
                    borderRadius: "0.5rem",
                    fontSize: "0.75rem",
                    fontFamily: "monospace",
                  }}
                />
              </div>
            )}

            <div style={{ display: "flex", gap: "1rem", justifyContent: "flex-end", marginTop: "1.5rem" }}>
              <button
                type="button"
                onClick={() => {
                  setEditingQuestionIndex(null);
                  setEditingQuestion(null);
                }}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button type="button" onClick={handleSaveEditedQuestion} className="btn-primary">
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add CSS for spinner animation */}
      <style jsx>{`
        @keyframes spin {
          0% {
            transform: rotate(0deg);
          }
          100% {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  );
}

// Server-side authentication check
export const getServerSideProps: GetServerSideProps = requireAuth;


