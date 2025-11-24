import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/router";
import { GetServerSideProps } from "next";
import { requireAuth } from "../../lib/auth";
import Link from "next/link";
import axios from "axios";

const QUESTION_TYPES = ["MCQ", "Subjective", "Pseudo Code", "Descriptive"];
const DIFFICULTY_LEVELS = ["Easy", "Medium", "Hard"];

interface Topic {
  topic: string;
  questionType: string;
  difficulty: string;
  numQuestions: number;
}

export default function CreateNewAssessmentPage() {
  const router = useRouter();
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
  const [isEditMode, setIsEditMode] = useState(false);
  const [hasVisitedReviewStation, setHasVisitedReviewStation] = useState(false);
  const [isConfigureEditMode, setIsConfigureEditMode] = useState(false);

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
      const response = await axios.post("/api/assessments/create-from-job-designation", {
        jobDesignation: jobDesignation.trim(),
        selectedSkills: selectedSkills,
        experienceMin: experienceMin.toString(),
        experienceMax: experienceMax.toString(),
      });

      if (response.data?.success) {
        const data = response.data.data;
        setTopics(data.assessment.topics.map((t: any) => t.topic));
        setAvailableQuestionTypes(data.questionTypes || QUESTION_TYPES);
        setAssessmentId(data.assessment._id || data.assessment.id);
        setTopicConfigs(
          data.assessment.topics.map((t: any) => ({
            topic: t.topic,
            questionType: t.questionTypes?.[0] || data.questionTypes?.[0] || QUESTION_TYPES[0], // Use default from backend
            difficulty: t.difficulty || "Medium", // Use default from backend
            numQuestions: 1,
          }))
        );
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


  const handleUpdateTopicConfig = (index: number, field: keyof Topic, value: any) => {
    const updated = [...topicConfigs];
    updated[index] = { ...updated[index], [field]: value };
    setTopicConfigs(updated);
  };

  const handleAddNewTopic = () => {
    const newTopic: Topic = {
      topic: "",
      questionType: availableQuestionTypes[0] || QUESTION_TYPES[0],
      difficulty: "Medium",
      numQuestions: 1,
    };
    setTopicConfigs([...topicConfigs, newTopic]);
  };

  const handleRemoveTopic = (index: number) => {
    setTopicConfigs(topicConfigs.filter((_, i) => i !== index));
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
          setTopics(data.assessment.topics.map((t: any) => t.topic));
          setAvailableQuestionTypes(data.questionTypes || QUESTION_TYPES);
          setAssessmentId(data.assessment._id || data.assessment.id);
          const newTopicConfigs = data.assessment.topics.map((t: any) => ({
            topic: t.topic,
            questionType: t.questionTypes?.[0] || data.questionTypes?.[0] || QUESTION_TYPES[0],
            difficulty: t.difficulty || "Medium",
            numQuestions: 1,
          }));
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

    const invalidConfigs = validConfigs.filter(
      (tc) => !tc.questionType || !tc.difficulty || tc.numQuestions < 1
    );
    if (invalidConfigs.length > 0) {
      setError("Please complete all configurations for all topics");
      return;
    }

    // Update topicConfigs to only include valid topics
    setTopicConfigs(validConfigs);

    // Check if we need to regenerate questions
    // Only regenerate if:
    // 1. User has visited Review station (came back from Review)
    // 2. Edit mode was active
    // 3. Changes were made (compare with original configs)
    const shouldRegenerate = hasVisitedReviewStation && isConfigureEditMode && 
      JSON.stringify(validConfigs) !== JSON.stringify(originalTopicConfigsRef.current);

    if (shouldRegenerate) {
      setGenerating(true);
      setError(null);

      try {
        const response = await axios.post("/api/assessments/generate-questions-from-config", {
          assessmentId,
          skill: selectedSkills.join(", "),
          topics: validConfigs,
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
          setIsConfigureEditMode(false);
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
            topics: validConfigs,
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
        setIsConfigureEditMode(false);
        setCurrentStation(3);
      }
    }
  };

  const handleRemoveQuestion = (questionIndex: number) => {
    setQuestions(questions.filter((_, idx) => idx !== questionIndex));
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
    if (!finalTitle.trim()) {
      setError("Title is required");
      return;
    }

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
      const response = await axios.post("/api/assessments/finalize", {
        assessmentId,
        title: finalTitle.trim(),
        description: finalDescription.trim() || undefined,
        questionTypeTimes: enablePerSectionTimers ? questionTypeTimes : undefined,
        enablePerSectionTimers: enablePerSectionTimers,
        passPercentage: passPercentage,
      });

      if (response.data?.success) {
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
          <div style={{ marginBottom: "2rem" }}>
            <Link
              href="/dashboard"
              style={{
                color: "#6953a3",
                textDecoration: "none",
                fontWeight: 600,
                display: "inline-flex",
                alignItems: "center",
                gap: "0.5rem",
              }}
            >
              <span>←</span> Back to Dashboard
            </Link>
          </div>

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

          {/* Station 1: Topics */}
          {currentStation === 1 && (
            <div>
              <h1 style={{ marginBottom: "0.5rem", fontSize: "2rem", color: "#1a1625", fontWeight: 700 }}>
                Create Assessment
              </h1>
              <p style={{ color: "#6b6678", marginBottom: "2rem", fontSize: "1rem" }}>
                Enter a job designation or domain to get started
              </p>

              <div style={{ marginBottom: "2rem" }}>
                <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1e293b" }}>
                  Job Designation / Domain *
                </label>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <input
                    type="text"
                    value={jobDesignation}
                    onChange={(e) => setJobDesignation(e.target.value)}
                    onKeyPress={(e) => {
                      if (e.key === "Enter" && jobDesignation.trim()) {
                        handleGenerateTopicCards();
                      }
                    }}
                    placeholder="e.g., Software Engineering, Aptitude, Data Scientist, Frontend Developer"
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
                    onClick={handleGenerateTopicCards}
                    className="btn-primary"
                    disabled={loadingCards || !jobDesignation.trim() || (hasVisitedConfigureStation && !isEditMode)}
                    style={{ 
                      marginTop: 0, 
                      whiteSpace: "nowrap", 
                      padding: "0.75rem 1.5rem",
                      opacity: (hasVisitedConfigureStation && !isEditMode) ? 0.5 : 1,
                      cursor: (hasVisitedConfigureStation && !isEditMode) ? "not-allowed" : "pointer",
                    }}
                  >
                    {loadingCards ? "Loading..." : "Get Skills"}
                  </button>
                </div>
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


              {hasVisitedConfigureStation && !isEditMode && (
                <div style={{ marginBottom: "1.5rem", display: "flex", justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    onClick={() => setIsEditMode(true)}
                    className="btn-secondary"
                    style={{ marginTop: 0 }}
                  >
                    Edit
                  </button>
                </div>
              )}

              <div style={{ display: "flex", gap: "1rem", marginTop: "2rem" }}>
                {isEditMode ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setIsEditMode(false);
                        setError(null);
                      }}
                      className="btn-secondary"
                      style={{ flex: 1 }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        if (selectedSkills.length === 0) {
                          setError("Please select at least one skill to assess");
                          return;
                        }
                        setIsEditMode(false);
                        await handleGenerateTopics();
                      }}
                      className="btn-primary"
                      disabled={loading || selectedSkills.length === 0}
                      style={{ flex: 1 }}
                    >
                      {loading ? "Regenerating Topics..." : "Regenerate Topics"}
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
              <h1 style={{ marginBottom: "0.5rem", fontSize: "2rem", color: "#1a1625", fontWeight: 700 }}>
                Configure Topics
              </h1>
              <p style={{ color: "#6b6678", marginBottom: "2rem", fontSize: "1rem" }}>
                Configure question type, difficulty, and number of questions for each topic. You can also add your own topics.
              </p>

              {hasVisitedReviewStation && !isConfigureEditMode && (
                <div style={{ marginBottom: "1.5rem", display: "flex", justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    onClick={() => {
                      setIsConfigureEditMode(true);
                      // Save current configs as original when entering edit mode
                      originalTopicConfigsRef.current = JSON.parse(JSON.stringify(topicConfigs));
                    }}
                    className="btn-secondary"
                    style={{ marginTop: 0 }}
                  >
                    Edit
                  </button>
                </div>
              )}

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
                    {topicConfigs.map((config, index) => (
                      <tr key={index} style={{ borderBottom: "1px solid #e2e8f0" }}>
                        <td style={{ padding: "1rem" }}>
                          <input
                            type="text"
                            value={config.topic}
                            onChange={(e) => handleUpdateTopicConfig(index, "topic", e.target.value)}
                            placeholder="Enter topic name"
                            disabled={hasVisitedReviewStation && !isConfigureEditMode}
                            style={{
                              width: "100%",
                              padding: "0.5rem",
                              border: "1px solid #e2e8f0",
                              borderRadius: "0.5rem",
                              fontSize: "0.875rem",
                              backgroundColor: (hasVisitedReviewStation && !isConfigureEditMode) ? "#f1f5f9" : "#ffffff",
                              cursor: (hasVisitedReviewStation && !isConfigureEditMode) ? "not-allowed" : "text",
                              opacity: (hasVisitedReviewStation && !isConfigureEditMode) ? 0.6 : 1,
                            }}
                          />
                        </td>
                        <td style={{ padding: "1rem" }}>
                          <select
                            value={config.questionType}
                            onChange={(e) => handleUpdateTopicConfig(index, "questionType", e.target.value)}
                            disabled={hasVisitedReviewStation && !isConfigureEditMode}
                            style={{
                              width: "100%",
                              padding: "0.5rem",
                              border: "1px solid #e2e8f0",
                              borderRadius: "0.5rem",
                              fontSize: "0.875rem",
                              backgroundColor: (hasVisitedReviewStation && !isConfigureEditMode) ? "#f1f5f9" : "#ffffff",
                              cursor: (hasVisitedReviewStation && !isConfigureEditMode) ? "not-allowed" : "pointer",
                              opacity: (hasVisitedReviewStation && !isConfigureEditMode) ? 0.6 : 1,
                            }}
                          >
                            {availableQuestionTypes.map((type) => (
                              <option key={type} value={type}>
                                {type}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td style={{ padding: "1rem" }}>
                          <select
                            value={config.difficulty}
                            onChange={(e) => handleUpdateTopicConfig(index, "difficulty", e.target.value)}
                            disabled={hasVisitedReviewStation && !isConfigureEditMode}
                            style={{
                              width: "100%",
                              padding: "0.5rem",
                              border: "1px solid #e2e8f0",
                              borderRadius: "0.5rem",
                              fontSize: "0.875rem",
                              backgroundColor: (hasVisitedReviewStation && !isConfigureEditMode) ? "#f1f5f9" : "#ffffff",
                              cursor: (hasVisitedReviewStation && !isConfigureEditMode) ? "not-allowed" : "pointer",
                              opacity: (hasVisitedReviewStation && !isConfigureEditMode) ? 0.6 : 1,
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
                            value={config.numQuestions}
                            onChange={(e) =>
                              handleUpdateTopicConfig(index, "numQuestions", parseInt(e.target.value) || 1)
                            }
                            disabled={hasVisitedReviewStation && !isConfigureEditMode}
                            style={{
                              width: "100%",
                              padding: "0.5rem",
                              border: "1px solid #e2e8f0",
                              borderRadius: "0.5rem",
                              fontSize: "0.875rem",
                              backgroundColor: (hasVisitedReviewStation && !isConfigureEditMode) ? "#f1f5f9" : "#ffffff",
                              cursor: (hasVisitedReviewStation && !isConfigureEditMode) ? "not-allowed" : "text",
                              opacity: (hasVisitedReviewStation && !isConfigureEditMode) ? 0.6 : 1,
                            }}
                          />
                        </td>
                        <td style={{ padding: "1rem" }}>
                          <button
                            type="button"
                            onClick={() => handleRemoveTopic(index)}
                            disabled={hasVisitedReviewStation && !isConfigureEditMode}
                            style={{
                              background: "none",
                              border: "none",
                              color: (hasVisitedReviewStation && !isConfigureEditMode) ? "#94a3b8" : "#ef4444",
                              cursor: (hasVisitedReviewStation && !isConfigureEditMode) ? "not-allowed" : "pointer",
                              fontSize: "0.875rem",
                              padding: "0.25rem 0.5rem",
                              opacity: (hasVisitedReviewStation && !isConfigureEditMode) ? 0.5 : 1,
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

              <div style={{ marginBottom: "2rem", display: "flex", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={handleAddNewTopic}
                  className="btn-secondary"
                  disabled={hasVisitedReviewStation && !isConfigureEditMode}
                  style={{ 
                    marginTop: 0,
                    opacity: (hasVisitedReviewStation && !isConfigureEditMode) ? 0.5 : 1,
                    cursor: (hasVisitedReviewStation && !isConfigureEditMode) ? "not-allowed" : "pointer",
                  }}
                >
                  + Add Skill
                </button>
              </div>

              <div style={{ display: "flex", gap: "1rem", marginTop: "2rem" }}>
                {isConfigureEditMode ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setIsConfigureEditMode(false);
                        // Revert to original configs if canceling
                        setTopicConfigs(JSON.parse(JSON.stringify(originalTopicConfigsRef.current)));
                        setError(null);
                      }}
                      className="btn-secondary"
                      style={{ flex: 1 }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleNextToStation3}
                      className="btn-primary"
                      disabled={generating}
                      style={{ flex: 1 }}
                    >
                      {generating ? "Regenerating Questions..." : "Next"}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setIsEditMode(false);
                        setIsConfigureEditMode(false);
                        setCurrentStation(1);
                      }}
                      className="btn-secondary"
                      style={{ flex: 1 }}
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={handleNextToStation3}
                      className="btn-primary"
                      disabled={generating}
                      style={{ flex: 1 }}
                    >
                      {generating ? "Generating Questions..." : "Next"}
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Station 3: Review Questions */}
          {currentStation === 3 && (
            <div>
              <h1 style={{ marginBottom: "0.5rem", fontSize: "2rem", color: "#1a1625", fontWeight: 700 }}>
                Review Questions
              </h1>
              <p style={{ color: "#6b6678", marginBottom: "2rem", fontSize: "1rem" }}>
                Review questions grouped by type and set time for each question type
              </p>

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

              {questions.length === 0 ? (
                <div style={{ textAlign: "center", padding: "3rem", color: "#64748b" }}>
                  No questions generated yet.
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
                                        <p style={{ color: "#1e293b", lineHeight: 1.6, whiteSpace: "pre-wrap", margin: 0, fontSize: "0.9375rem" }}>
                                          {question.questionText}
                                        </p>
                                        {question.options && question.options.length > 0 && (
                                          <div style={{ marginTop: "0.75rem", fontSize: "0.875rem", color: "#64748b" }}>
                                            {question.options.slice(0, 2).map((option: string, optIndex: number) => (
                                              <div key={optIndex} style={{ marginBottom: "0.25rem" }}>
                                                {String.fromCharCode(65 + optIndex)}. {option.substring(0, 50)}{option.length > 50 ? "..." : ""}
                                              </div>
                                            ))}
                                            {question.options.length > 2 && (
                                              <div style={{ fontStyle: "italic" }}>+{question.options.length - 2} more options</div>
                                            )}
                                          </div>
                                        )}
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
                    Title <span style={{ color: "#dc2626" }}>*</span>
                  </label>
                  <input
                    type="text"
                    value={finalTitle}
                    onChange={(e) => setFinalTitle(e.target.value)}
                    placeholder="Enter assessment title"
                    required
                    style={{
                      width: "100%",
                      padding: "0.75rem",
                      border: "1px solid #e2e8f0",
                      borderRadius: "0.5rem",
                      fontSize: "1rem",
                    }}
                  />
                </div>
                <div style={{ marginBottom: "1.5rem" }}>
                  <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1e293b" }}>
                    Description
                  </label>
                  <textarea
                    value={finalDescription}
                    onChange={(e) => setFinalDescription(e.target.value)}
                    placeholder="Enter assessment description (optional)"
                    rows={4}
                    style={{
                      width: "100%",
                      padding: "0.75rem",
                      border: "1px solid #e2e8f0",
                      borderRadius: "0.5rem",
                      fontSize: "1rem",
                      fontFamily: "inherit",
                      resize: "vertical",
                    }}
                  />
                </div>
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
                  <button
                    type="button"
                    onClick={handleFinalize}
                    className="btn-primary"
                    disabled={loading || !finalTitle.trim()}
                    style={{ flex: 1 }}
                  >
                    {loading ? "Finalizing..." : "Finalize Assessment"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Station 4: Schedule Exam */}
          {currentStation === 4 && (
            <div>
              <h1 style={{ marginBottom: "0.5rem", fontSize: "2rem", color: "#1a1625", fontWeight: 700 }}>
                Schedule Exam
              </h1>
              <p style={{ color: "#6b6678", marginBottom: "2rem", fontSize: "1rem" }}>
                Set the start and end time for the assessment (Indian Standard Time - IST)
              </p>

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
              <h1 style={{ marginBottom: "0.5rem", fontSize: "2rem", color: "#1a1625", fontWeight: 700 }}>
                Add Candidates
              </h1>
              <p style={{ color: "#6b6678", marginBottom: "2rem", fontSize: "1rem" }}>
                Add candidates who will take this assessment. A unique URL will be generated for all candidates.
              </p>

              <div style={{ marginBottom: "2rem" }}>
                <label style={{ display: "block", marginBottom: "0.75rem", fontWeight: 600, color: "#1e293b" }}>
                  Add Candidate
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
                    try {
                      await handleGenerateUrl();
                      router.push("/dashboard");
                    } catch (err: any) {
                      setError("Failed to save. Please try again.");
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
    </div>
  );
}

// Server-side authentication check
export const getServerSideProps: GetServerSideProps = requireAuth;

