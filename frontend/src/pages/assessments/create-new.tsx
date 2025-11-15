import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/router";
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
  const [skill, setSkill] = useState("");
  const [topics, setTopics] = useState<string[]>([]);
  const [customTopic, setCustomTopic] = useState("");
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

  const sliderRef = useRef<HTMLDivElement>(null);
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
  }, []);

  const handleGenerateTopics = async () => {
    if (!skill.trim()) {
      setError("Please enter a skill/domain");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await axios.post("/api/assessments/create-from-skill", {
        skill: skill.trim(),
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
            questionType: data.questionTypes?.[0] || QUESTION_TYPES[0],
            difficulty: "Medium",
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

  const handleAddCustomTopic = () => {
    if (customTopic.trim() && !topics.includes(customTopic.trim())) {
      setTopics([...topics, customTopic.trim()]);
      setTopicConfigs([
        ...topicConfigs,
        {
          topic: customTopic.trim(),
          questionType: availableQuestionTypes[0],
          difficulty: "Medium",
          numQuestions: 1,
        },
      ]);
      setCustomTopic("");
    }
  };

  const handleRemoveTopic = (topicToRemove: string) => {
    setTopics(topics.filter((t) => t !== topicToRemove));
    setTopicConfigs(topicConfigs.filter((tc) => tc.topic !== topicToRemove));
  };

  const handleUpdateTopicConfig = (topic: string, field: keyof Topic, value: any) => {
    setTopicConfigs(
      topicConfigs.map((tc) => (tc.topic === topic ? { ...tc, [field]: value } : tc))
    );
  };

  const handleNextToStation2 = () => {
    if (topics.length === 0) {
      setError("Please add at least one topic");
      return;
    }
    setError(null);
    setCurrentStation(2);
  };

  const handleNextToStation3 = async () => {
    if (topicConfigs.length === 0) {
      setError("Please configure at least one topic");
      return;
    }

    const invalidConfigs = topicConfigs.filter(
      (tc) => !tc.questionType || !tc.difficulty || tc.numQuestions < 1
    );
    if (invalidConfigs.length > 0) {
      setError("Please complete all configurations for all topics");
      return;
    }

    setGenerating(true);
    setError(null);

    try {
      const response = await axios.post("/api/assessments/generate-questions-from-config", {
        assessmentId,
        skill: skill.trim(),
        topics: topicConfigs,
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
  };

  const handleRemoveQuestion = (questionIndex: number) => {
    setQuestions(questions.filter((_, idx) => idx !== questionIndex));
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

      // Then finalize
      const response = await axios.post("/api/assessments/finalize", {
        assessmentId,
        title: finalTitle.trim(),
        description: finalDescription.trim() || undefined,
      });

      if (response.data?.success) {
        router.push("/dashboard");
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
                  width: currentStation >= 2 ? "50%" : currentStation >= 3 ? "100%" : "0%",
                  height: "3px",
                  backgroundColor: "#6953a3",
                  zIndex: 1,
                  transition: "width 0.3s ease",
                }}
              />
              {[1, 2, 3].map((station) => (
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
                    {station === 1 ? "Topics" : station === 2 ? "Configure" : "Review"}
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
                Enter a skill or domain to generate relevant topics
              </p>

              <div style={{ marginBottom: "2rem" }}>
                <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1e293b" }}>
                  Skill/Domain *
                </label>
                <input
                  type="text"
                  value={skill}
                  onChange={(e) => setSkill(e.target.value)}
                  onKeyPress={(e) => {
                    if (e.key === "Enter" && skill.trim()) {
                      handleGenerateTopics();
                    }
                  }}
                  placeholder="e.g., Python, Java, Softskill, Communication"
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
                    cursor: "pointer",
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
                      cursor: "grab",
                      zIndex: 3,
                      userSelect: "none",
                      touchAction: "none",
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
                      cursor: "grab",
                      zIndex: 3,
                      userSelect: "none",
                      touchAction: "none",
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

              {topics.length > 0 && (
                <div style={{ marginBottom: "2rem" }}>
                  <label style={{ display: "block", marginBottom: "0.75rem", fontWeight: 600, color: "#1e293b" }}>
                    Topics
                  </label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginBottom: "1rem" }}>
                    {topics.map((topic) => (
                      <div
                        key={topic}
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
                        {topic}
                        <button
                          type="button"
                          onClick={() => handleRemoveTopic(topic)}
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
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ marginBottom: "2rem" }}>
                <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, color: "#1e293b" }}>
                  Add Custom Topic
                </label>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <input
                    type="text"
                    value={customTopic}
                    onChange={(e) => setCustomTopic(e.target.value)}
                    onKeyPress={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddCustomTopic();
                      }
                    }}
                    placeholder="Enter custom topic"
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
                    onClick={handleAddCustomTopic}
                    className="btn-secondary"
                    disabled={!customTopic.trim()}
                    style={{ marginTop: 0, whiteSpace: "nowrap", padding: "0.75rem 1.5rem" }}
                  >
                    Add
                  </button>
                </div>
              </div>

              <div style={{ display: "flex", gap: "1rem", marginTop: "2rem" }}>
                <button
                  type="button"
                  onClick={handleGenerateTopics}
                  className="btn-primary"
                  disabled={loading || !skill.trim()}
                  style={{ flex: 1 }}
                >
                  {loading ? "Generating..." : "Generate Topics"}
                </button>
                {topics.length > 0 && (
                  <button type="button" onClick={handleNextToStation2} className="btn-primary" style={{ flex: 1 }}>
                    Next
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
                Configure question type, difficulty, and number of questions for each topic
              </p>

              <div style={{ overflowX: "auto", marginBottom: "2rem" }}>
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
                    </tr>
                  </thead>
                  <tbody>
                    {topicConfigs.map((config, index) => (
                      <tr key={index} style={{ borderBottom: "1px solid #e2e8f0" }}>
                        <td style={{ padding: "1rem" }}>{config.topic}</td>
                        <td style={{ padding: "1rem" }}>
                          <select
                            value={config.questionType}
                            onChange={(e) => handleUpdateTopicConfig(config.topic, "questionType", e.target.value)}
                            style={{
                              width: "100%",
                              padding: "0.5rem",
                              border: "1px solid #e2e8f0",
                              borderRadius: "0.5rem",
                              fontSize: "0.875rem",
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
                            onChange={(e) => handleUpdateTopicConfig(config.topic, "difficulty", e.target.value)}
                            style={{
                              width: "100%",
                              padding: "0.5rem",
                              border: "1px solid #e2e8f0",
                              borderRadius: "0.5rem",
                              fontSize: "0.875rem",
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
                              handleUpdateTopicConfig(config.topic, "numQuestions", parseInt(e.target.value) || 1)
                            }
                            style={{
                              width: "100%",
                              padding: "0.5rem",
                              border: "1px solid #e2e8f0",
                              borderRadius: "0.5rem",
                              fontSize: "0.875rem",
                            }}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
                  onClick={handleNextToStation3}
                  className="btn-primary"
                  disabled={generating}
                  style={{ flex: 1 }}
                >
                  {generating ? "Generating Questions..." : "Next"}
                </button>
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
                Review and remove questions if needed, then finalize your assessment
              </p>

              {questions.length === 0 ? (
                <div style={{ textAlign: "center", padding: "3rem", color: "#64748b" }}>
                  No questions generated yet.
                </div>
              ) : (
                <div style={{ marginBottom: "2rem" }}>
                  {questions.map((question, index) => (
                    <div
                      key={index}
                      style={{
                        border: "1px solid #e2e8f0",
                        borderRadius: "0.75rem",
                        padding: "1.5rem",
                        marginBottom: "1rem",
                        backgroundColor: "#ffffff",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: "1rem" }}>
                        <div>
                          <span
                            style={{
                              backgroundColor: "#6953a3",
                              color: "#ffffff",
                              padding: "0.25rem 0.75rem",
                              borderRadius: "9999px",
                              fontSize: "0.75rem",
                              fontWeight: 700,
                              marginRight: "0.5rem",
                            }}
                          >
                            Q{index + 1}
                          </span>
                          <span
                            style={{
                              backgroundColor: "#eff6ff",
                              color: "#1e40af",
                              padding: "0.25rem 0.75rem",
                              borderRadius: "9999px",
                              fontSize: "0.75rem",
                              fontWeight: 600,
                              marginRight: "0.5rem",
                            }}
                          >
                            {question.type}
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
                        <button
                          type="button"
                          onClick={() => handleRemoveQuestion(index)}
                          style={{
                            background: "none",
                            border: "none",
                            color: "#ef4444",
                            cursor: "pointer",
                            fontSize: "1.125rem",
                            padding: "0.25rem",
                          }}
                        >
                          ×
                        </button>
                      </div>
                      <p style={{ color: "#1e293b", lineHeight: 1.7, whiteSpace: "pre-wrap", margin: 0 }}>
                        {question.questionText}
                      </p>
                      {question.options && (
                        <div style={{ marginTop: "1rem" }}>
                          {question.options.map((option: string, optIndex: number) => (
                            <div
                              key={optIndex}
                              style={{
                                padding: "0.5rem",
                                backgroundColor: "#f8fafc",
                                borderRadius: "0.5rem",
                                marginBottom: "0.5rem",
                              }}
                            >
                              {String.fromCharCode(65 + optIndex)}. {option}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
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
                <div style={{ display: "flex", gap: "1rem" }}>
                  <button
                    type="button"
                    onClick={() => setCurrentStation(2)}
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
        </div>
      </div>
    </div>
  );
}

