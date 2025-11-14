import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import axios from "axios";

const QUESTION_TYPES = ["MCQ", "Subjective", "Pseudo Code", "Descriptive", "Aptitude", "Reasoning"];
const DIFFICULTY_LEVELS = ["Easy", "Medium", "Hard"];

interface Topic {
  topic: string;
  numQuestions: number;
  questionTypes: string[];
  difficulty: string;
  source: string;
  questions: any[];
  questionConfigs: any[];
  category?: string; // "aptitude" or "technical"
}

export default function ConfigureTopicsPage() {
  const router = useRouter();
  const { id } = router.query;
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newTopic, setNewTopic] = useState("");

  useEffect(() => {
    if (id) {
      fetchTopics();
    }
  }, [id]);

  const fetchTopics = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await axios.get(`/api/assessments/get-topics?assessmentId=${id}`);
      if (response.data?.success && response.data?.data) {
        // Ensure aptitude topics have MCQ only, and technical topics have at most one question type
        const topicsData = response.data.data.map((topic: Topic) => {
          if (topic.category === "aptitude") {
            return { ...topic, questionTypes: ["MCQ"] };
          } else {
            // For technical topics, ensure only one question type is selected
            const questionTypes = topic.questionTypes || [];
            return { ...topic, questionTypes: questionTypes.length > 0 ? [questionTypes[0]] : [] };
          }
        });
        setTopics(topicsData);
      }
    } catch (err: any) {
      console.error("Error fetching topics:", err);
      setError(err.response?.data?.message || err.message || "Failed to load topics");
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateTopic = (topicName: string, field: string, value: any) => {
    const updatedTopics = topics.map((topic) =>
      topic.topic === topicName ? { ...topic, [field]: value } : topic
    );
    setTopics(updatedTopics);
  };

  const handleToggleQuestionType = (topicName: string, questionType: string) => {
    const topic = topics.find((t) => t.topic === topicName);
    if (!topic) return;
    
    // For aptitude topics, always keep MCQ only (no toggle needed)
    if (topic.category === "aptitude") {
      handleUpdateTopic(topicName, "questionTypes", ["MCQ"]);
      return;
    }
    
    // For technical topics, allow only ONE selection at a time (radio button behavior)
    const currentTypes = topic.questionTypes || [];
    if (currentTypes.includes(questionType)) {
      // If clicking the already selected type, keep it selected (don't deselect)
      handleUpdateTopic(topicName, "questionTypes", [questionType]);
    } else {
      // Select the new type (replace all previous selections)
      handleUpdateTopic(topicName, "questionTypes", [questionType]);
    }
  };

  const handleAddCustomTopic = async () => {
    if (!newTopic.trim()) return;

    try {
      const response = await axios.post("/api/assessments/add-topic", {
        assessmentId: id,
        newTopics: [newTopic.trim()],
      });

      if (response.data?.success && response.data?.data) {
        setTopics(response.data.data);
        setNewTopic("");
      }
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || "Failed to add topic");
    }
  };

  const handleRemoveTopic = async (topicName: string) => {
    if (!confirm(`Are you sure you want to remove "${topicName}"?`)) return;

    try {
      const response = await axios.delete("/api/assessments/remove-topic", {
        data: {
          assessmentId: id,
          topicsToRemove: [topicName],
        },
      });

      if (response.data?.success && response.data?.data) {
        setTopics(response.data.data);
      }
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || "Failed to remove topic");
    }
  };

  const handleSaveAndContinue = async () => {
    // Ensure aptitude topics have MCQ only, and technical topics have exactly one question type
    const updatedTopics = topics.map((topic) => {
      if (topic.category === "aptitude") {
        return { ...topic, questionTypes: ["MCQ"] };
      } else {
        // For technical topics, ensure only one question type is selected
        const questionTypes = topic.questionTypes || [];
        return { ...topic, questionTypes: questionTypes.length > 0 ? [questionTypes[0]] : [] };
      }
    });
    
    // Validate that at least one topic has questions configured
    const validTopics = updatedTopics.filter(
      (t) => t.numQuestions > 0 && t.questionTypes && t.questionTypes.length > 0
    );

    if (validTopics.length === 0) {
      setError("Please configure at least one topic with questions and question types");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const updatedTopics = topics.map((topic) => {
        // Ensure aptitude topics have MCQ only
        let questionTypes = topic.questionTypes || [];
        if (topic.category === "aptitude") {
          questionTypes = ["MCQ"];
        } else {
          // For technical topics, ensure only one question type is selected
          questionTypes = questionTypes.length > 0 ? [questionTypes[0]] : [];
        }
        
        return {
          topic: topic.topic,
          numQuestions: topic.numQuestions,
          questionTypes: questionTypes,
          difficulty: topic.difficulty,
        };
      });

      const response = await axios.post("/api/assessments/update-topics", {
        assessmentId: id,
        updatedTopics,
      });

      if (response.data?.success) {
        router.push(`/assessments/${id}/questions`);
      } else {
        setError("Failed to save topic configuration");
      }
    } catch (err: any) {
      console.error("Error updating topics:", err);
      setError(err.response?.data?.message || err.message || "Failed to save configuration");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="container">
        <div className="card">
          <p style={{ textAlign: "center", color: "#475569" }}>Loading topics...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="card">
        <div style={{ marginBottom: "2rem" }}>
          <Link href="/dashboard" style={{ color: "#3b82f6", textDecoration: "none" }}>
            ← Back to Dashboard
          </Link>
        </div>

        <h1 style={{ marginBottom: "0.5rem" }}>Configure Topics</h1>
        <p style={{ color: "#475569", marginBottom: "2rem" }}>
          Configure the number of questions, question types, and difficulty for each topic. You can also add custom topics.
        </p>

        {error && (
          <div className="alert alert-error" style={{ marginBottom: "1.5rem" }}>
            {error}
          </div>
        )}

        {/* Add Custom Topic */}
        <div style={{ marginBottom: "2rem", padding: "1.5rem", backgroundColor: "#f8fafc", borderRadius: "0.75rem" }}>
          <h3 style={{ marginBottom: "1rem", fontSize: "1.125rem" }}>Add Custom Topic</h3>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <input
              type="text"
              value={newTopic}
              onChange={(e) => setNewTopic(e.target.value)}
              onKeyPress={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddCustomTopic();
                }
              }}
              placeholder="Enter topic name"
              style={{
                flex: 1,
                padding: "0.75rem",
                border: "1px solid #e2e8f0",
                borderRadius: "0.5rem",
                fontSize: "1rem",
              }}
            />
            <button type="button" onClick={handleAddCustomTopic} className="btn-secondary" disabled={!newTopic.trim()}>
              Add Topic
            </button>
          </div>
        </div>

        {/* Topics List - Grouped by Category */}
        <div style={{ marginBottom: "2rem" }}>
          {topics.length === 0 ? (
            <p style={{ textAlign: "center", color: "#64748b", padding: "2rem" }}>No topics available</p>
          ) : (
            <>
              {/* Aptitude Topics Section */}
              {topics.some((t) => t.category === "aptitude") && (
                <div style={{ marginBottom: "2.5rem" }}>
                  <h2 style={{ marginBottom: "1rem", fontSize: "1.25rem", color: "#0f172a", borderBottom: "2px solid #3b82f6", paddingBottom: "0.5rem" }}>
                    Aptitude Topics
                  </h2>
                  {topics
                    .filter((topic) => topic.category === "aptitude")
                    .map((topic) => (
              <div
                key={topic.topic}
                style={{
                  border: "1px solid #e2e8f0",
                  borderRadius: "0.75rem",
                  padding: "1.5rem",
                  marginBottom: "1.5rem",
                  backgroundColor: "#ffffff",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: "1rem" }}>
                  <div>
                    <h3 style={{ margin: 0, color: "#0f172a", fontSize: "1.125rem" }}>{topic.topic}</h3>
                    <span
                      style={{
                        fontSize: "0.75rem",
                        color: "#64748b",
                        marginTop: "0.25rem",
                        display: "inline-block",
                      }}
                    >
                      Source: {topic.source}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveTopic(topic.topic)}
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
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
                  <div>
                    <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500, color: "#1e293b" }}>
                      Number of Questions
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="20"
                      value={topic.numQuestions || ""}
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === "" || val === null || val === undefined) {
                          handleUpdateTopic(topic.topic, "numQuestions", 0);
                        } else {
                          const num = parseInt(val, 10);
                          if (!isNaN(num) && num >= 0) {
                            handleUpdateTopic(topic.topic, "numQuestions", num);
                          }
                        }
                      }}
                      onKeyDown={(e) => {
                        // Allow: backspace, delete, tab, escape, enter, decimal point
                        if ([46, 8, 9, 27, 13, 110, 190].indexOf(e.keyCode) !== -1 ||
                          // Allow: Ctrl+A, Ctrl+C, Ctrl+V, Ctrl+X
                          (e.keyCode === 65 && e.ctrlKey === true) ||
                          (e.keyCode === 67 && e.ctrlKey === true) ||
                          (e.keyCode === 86 && e.ctrlKey === true) ||
                          (e.keyCode === 88 && e.ctrlKey === true) ||
                          // Allow: home, end, left, right
                          (e.keyCode >= 35 && e.keyCode <= 39)) {
                          return;
                        }
                        // Ensure that it is a number and stop the keypress
                        if ((e.shiftKey || (e.keyCode < 48 || e.keyCode > 57)) && (e.keyCode < 96 || e.keyCode > 105)) {
                          e.preventDefault();
                        }
                      }}
                      style={{
                        width: "100%",
                        padding: "0.75rem",
                        border: "1px solid #e2e8f0",
                        borderRadius: "0.5rem",
                        fontSize: "1rem",
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500, color: "#1e293b" }}>
                      Difficulty
                    </label>
                    <select
                      value={topic.difficulty || "Medium"}
                      onChange={(e) => handleUpdateTopic(index, "difficulty", e.target.value)}
                      style={{
                        width: "100%",
                        padding: "0.75rem",
                        border: "1px solid #e2e8f0",
                        borderRadius: "0.5rem",
                        fontSize: "1rem",
                        backgroundColor: "#ffffff",
                      }}
                    >
                      {DIFFICULTY_LEVELS.map((level) => (
                        <option key={level} value={level}>
                          {level}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div style={{ marginTop: "1rem" }}>
                  <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500, color: "#1e293b" }}>
                    Question Types {topic.category === "aptitude" && <span style={{ fontSize: "0.875rem", color: "#64748b", fontWeight: 400 }}>(MCQ only for aptitude)</span>}
                  </label>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                    {(topic.category === "aptitude" ? ["MCQ"] : QUESTION_TYPES).map((type) => {
                      // For aptitude, MCQ is always selected
                      // For technical, check if this is the selected one (only one should be selected)
                      const isSelected = topic.category === "aptitude" 
                        ? type === "MCQ" 
                        : (topic.questionTypes || []).includes(type) && (topic.questionTypes || []).length === 1 && (topic.questionTypes || [])[0] === type;
                      return (
                        <button
                          key={type}
                          type="button"
                          onClick={() => handleToggleQuestionType(topic.topic, type)}
                          disabled={topic.category === "aptitude"}
                          style={{
                            padding: "0.5rem 1rem",
                            border: `1px solid ${isSelected ? "#3b82f6" : "#e2e8f0"}`,
                            borderRadius: "0.5rem",
                            backgroundColor: isSelected ? "#eff6ff" : "#ffffff",
                            color: isSelected ? "#1e40af" : topic.category === "aptitude" ? "#94a3b8" : "#475569",
                            cursor: topic.category === "aptitude" ? "not-allowed" : "pointer",
                            fontSize: "0.875rem",
                            fontWeight: isSelected ? 600 : 400,
                            opacity: topic.category === "aptitude" ? 0.7 : 1,
                          }}
                        >
                          {type}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
                    ))}
                </div>
              )}

              {/* Technical Topics Section */}
              {topics.some((t) => t.category === "technical" || !t.category) && (
                <div style={{ marginBottom: "2.5rem" }}>
                  <h2 style={{ marginBottom: "1rem", fontSize: "1.25rem", color: "#0f172a", borderBottom: "2px solid #3b82f6", paddingBottom: "0.5rem" }}>
                    Technical Topics
                  </h2>
                  {topics
                    .filter((topic) => topic.category === "technical" || !topic.category)
                    .map((topic) => (
                      <div
                        key={topic.topic}
                        style={{
                          border: "1px solid #e2e8f0",
                          borderRadius: "0.75rem",
                          padding: "1.5rem",
                          marginBottom: "1.5rem",
                          backgroundColor: "#ffffff",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: "1rem" }}>
                          <div>
                            <h3 style={{ margin: 0, color: "#0f172a", fontSize: "1.125rem" }}>{topic.topic}</h3>
                            <span
                              style={{
                                fontSize: "0.75rem",
                                color: "#64748b",
                                marginTop: "0.25rem",
                                display: "inline-block",
                              }}
                            >
                              Source: {topic.source}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemoveTopic(topic.topic)}
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
                        </div>

                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
                          <div>
                            <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500, color: "#1e293b" }}>
                              Number of Questions
                            </label>
                            <input
                              type="number"
                              min="0"
                              max="20"
                              value={topic.numQuestions || ""}
                              onFocus={(e) => e.target.select()}
                              onChange={(e) => {
                                const val = e.target.value;
                                if (val === "" || val === null || val === undefined) {
                                  handleUpdateTopic(topic.topic, "numQuestions", 0);
                                } else {
                                  const num = parseInt(val, 10);
                                  if (!isNaN(num) && num >= 0) {
                                    handleUpdateTopic(topic.topic, "numQuestions", num);
                                  }
                                }
                              }}
                              onKeyDown={(e) => {
                                // Allow: backspace, delete, tab, escape, enter, decimal point
                                if ([46, 8, 9, 27, 13, 110, 190].indexOf(e.keyCode) !== -1 ||
                                  // Allow: Ctrl+A, Ctrl+C, Ctrl+V, Ctrl+X
                                  (e.keyCode === 65 && e.ctrlKey === true) ||
                                  (e.keyCode === 67 && e.ctrlKey === true) ||
                                  (e.keyCode === 86 && e.ctrlKey === true) ||
                                  (e.keyCode === 88 && e.ctrlKey === true) ||
                                  // Allow: home, end, left, right
                                  (e.keyCode >= 35 && e.keyCode <= 39)) {
                                  return;
                                }
                                // Ensure that it is a number and stop the keypress
                                if ((e.shiftKey || (e.keyCode < 48 || e.keyCode > 57)) && (e.keyCode < 96 || e.keyCode > 105)) {
                                  e.preventDefault();
                                }
                              }}
                              style={{
                                width: "100%",
                                padding: "0.75rem",
                                border: "1px solid #e2e8f0",
                                borderRadius: "0.5rem",
                                fontSize: "1rem",
                              }}
                            />
                          </div>

                          <div>
                            <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500, color: "#1e293b" }}>
                              Difficulty
                            </label>
                            <select
                              value={topic.difficulty || "Medium"}
                              onChange={(e) => handleUpdateTopic(topic.topic, "difficulty", e.target.value)}
                              style={{
                                width: "100%",
                                padding: "0.75rem",
                                border: "1px solid #e2e8f0",
                                borderRadius: "0.5rem",
                                fontSize: "1rem",
                                backgroundColor: "#ffffff",
                              }}
                            >
                              {DIFFICULTY_LEVELS.map((level) => (
                                <option key={level} value={level}>
                                  {level}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>

                        <div style={{ marginTop: "1rem" }}>
                          <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500, color: "#1e293b" }}>
                            Question Types {topic.category === "aptitude" && <span style={{ fontSize: "0.875rem", color: "#64748b", fontWeight: 400 }}>(MCQ only for aptitude)</span>}
                          </label>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                            {(topic.category === "aptitude" ? ["MCQ"] : QUESTION_TYPES).map((type) => {
                              // For aptitude, MCQ is always selected
                              // For technical, check if this is the selected one (only one should be selected)
                              const isSelected = topic.category === "aptitude" 
                                ? type === "MCQ" 
                                : (topic.questionTypes || []).includes(type) && (topic.questionTypes || []).length === 1 && (topic.questionTypes || [])[0] === type;
                              return (
                                <button
                                  key={type}
                                  type="button"
                                  onClick={() => handleToggleQuestionType(topic.topic, type)}
                                  disabled={topic.category === "aptitude"}
                                  style={{
                                    padding: "0.5rem 1rem",
                                    border: `1px solid ${isSelected ? "#3b82f6" : "#e2e8f0"}`,
                                    borderRadius: "0.5rem",
                                    backgroundColor: isSelected ? "#eff6ff" : "#ffffff",
                                    color: isSelected ? "#1e40af" : topic.category === "aptitude" ? "#94a3b8" : "#475569",
                                    cursor: topic.category === "aptitude" ? "not-allowed" : "pointer",
                                    fontSize: "0.875rem",
                                    fontWeight: isSelected ? 600 : 400,
                                    opacity: topic.category === "aptitude" ? 0.7 : 1,
                                  }}
                                >
                                  {type}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </>
          )}
        </div>

        <div style={{ display: "flex", gap: "1rem", marginTop: "2rem" }}>
          <button
            type="button"
            onClick={handleSaveAndContinue}
            className="btn-primary"
            disabled={saving || topics.length === 0}
          >
            {saving ? "Saving..." : "Save & Generate Questions"}
          </button>
          <Link href="/dashboard">
            <button type="button" className="btn-secondary">
              Cancel
            </button>
          </Link>
        </div>
      </div>
    </div>
  );
}




