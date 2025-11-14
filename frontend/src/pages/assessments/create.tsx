import { useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import axios from "axios";

const EXPERIENCE_LEVELS = ["0-2 years", "2-5 years", "5-10 years", "10+ years"];
const DIFFICULTY_LEVELS = ["Easy", "Medium", "Hard"];
const APTITUDE_CATEGORIES = [
  { key: "quantitative", label: "Quantitative" },
  { key: "logicalReasoning", label: "Logical Reasoning" },
  { key: "verbalAbility", label: "Verbal Ability" },
  { key: "numericalReasoning", label: "Numerical Reasoning" },
];

interface AptitudeCategoryState {
  enabled: boolean;
  difficulty: string;
  numQuestions: number;
}

export default function CreateAssessmentPage() {
  const router = useRouter();
  
  // Assessment type selection
  const [assessmentTypes, setAssessmentTypes] = useState<string[]>([]);
  
  // Technical fields
  const [jobRole, setJobRole] = useState("");
  const [experience, setExperience] = useState("");
  const [skills, setSkills] = useState<string[]>([]);
  const [currentSkill, setCurrentSkill] = useState("");
  const [numTopics, setNumTopics] = useState<number | "">("");
  
  // Aptitude fields
  const [aptitudeConfig, setAptitudeConfig] = useState<Record<string, AptitudeCategoryState>>({
    quantitative: { enabled: false, difficulty: "Medium", numQuestions: 0 },
    logicalReasoning: { enabled: false, difficulty: "Medium", numQuestions: 0 },
    verbalAbility: { enabled: false, difficulty: "Medium", numQuestions: 0 },
    numericalReasoning: { enabled: false, difficulty: "Medium", numQuestions: 0 },
  });
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAssessmentTypeChange = (type: string, checked: boolean) => {
    if (checked) {
      setAssessmentTypes([...assessmentTypes, type]);
    } else {
      setAssessmentTypes(assessmentTypes.filter((t) => t !== type));
    }
  };

  const handleAptitudeCategoryChange = (categoryKey: string, field: keyof AptitudeCategoryState, value: any) => {
    setAptitudeConfig({
      ...aptitudeConfig,
      [categoryKey]: {
        ...aptitudeConfig[categoryKey],
        [field]: value,
      },
    });
  };

  const handleAddSkill = () => {
    if (currentSkill.trim() && !skills.includes(currentSkill.trim())) {
      setSkills([...skills, currentSkill.trim()]);
      setCurrentSkill("");
    }
  };

  const handleRemoveSkill = (skillToRemove: string) => {
    setSkills(skills.filter((skill) => skill !== skillToRemove));
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddSkill();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validate assessment type selection
    if (assessmentTypes.length === 0) {
      setError("Please select at least one assessment type (Aptitude or Technical)");
      return;
    }

    // Validate technical fields if technical is selected
    if (assessmentTypes.includes("technical")) {
      if (!jobRole.trim()) {
        setError("Job role is required for technical assessments");
        return;
      }
      if (!experience) {
        setError("Experience level is required for technical assessments");
        return;
      }
      if (skills.length === 0) {
        setError("At least one skill is required for technical assessments");
        return;
      }
      if (numTopics === "" || (typeof numTopics === "number" && numTopics < 1)) {
        setError("Number of topics must be at least 1");
        return;
      }
    }

    // Validate aptitude fields if aptitude is selected
    if (assessmentTypes.includes("aptitude")) {
      const hasEnabledCategory = Object.values(aptitudeConfig).some((cat) => cat.enabled);
      if (!hasEnabledCategory) {
        setError("Please enable at least one aptitude category");
        return;
      }

      const enabledCategories = Object.entries(aptitudeConfig).filter(([_, cat]) => cat.enabled);
      for (const [key, cat] of enabledCategories) {
        if (cat.numQuestions <= 0) {
          setError(`Please specify number of questions for ${APTITUDE_CATEGORIES.find((c) => c.key === key)?.label}`);
          return;
        }
      }
    }

    setLoading(true);
    setError(null);

    try {
      // Build request payload
      const payload: any = {
        assessmentType: assessmentTypes,
      };

      if (assessmentTypes.includes("technical")) {
        payload.jobRole = jobRole.trim();
        payload.experience = experience;
        payload.skills = skills;
        payload.numTopics = numTopics === "" ? 1 : numTopics;
      }

      if (assessmentTypes.includes("aptitude")) {
        const aptConfig: any = {};
        if (aptitudeConfig.quantitative.enabled) {
          aptConfig.quantitative = {
            enabled: true,
            difficulty: aptitudeConfig.quantitative.difficulty,
            numQuestions: aptitudeConfig.quantitative.numQuestions,
          };
        }
        if (aptitudeConfig.logicalReasoning.enabled) {
          aptConfig.logicalReasoning = {
            enabled: true,
            difficulty: aptitudeConfig.logicalReasoning.difficulty,
            numQuestions: aptitudeConfig.logicalReasoning.numQuestions,
          };
        }
        if (aptitudeConfig.verbalAbility.enabled) {
          aptConfig.verbalAbility = {
            enabled: true,
            difficulty: aptitudeConfig.verbalAbility.difficulty,
            numQuestions: aptitudeConfig.verbalAbility.numQuestions,
          };
        }
        if (aptitudeConfig.numericalReasoning.enabled) {
          aptConfig.numericalReasoning = {
            enabled: true,
            difficulty: aptitudeConfig.numericalReasoning.difficulty,
            numQuestions: aptitudeConfig.numericalReasoning.numQuestions,
          };
        }
        payload.aptitudeConfig = aptConfig;
      }

      const response = await axios.post("/api/assessments/generate-topics", payload);

      if (response.data?.success && response.data?.data) {
        const assessmentId = response.data.data._id || response.data.data.id;
        router.push(`/assessments/${assessmentId}/configure`);
      } else {
        setError("Failed to generate topics. Please try again.");
      }
    } catch (err: any) {
      console.error("Error generating topics:", err);
      setError(err.response?.data?.message || err.message || "Failed to generate topics. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const showTechnicalSection = assessmentTypes.includes("technical");
  const showAptitudeSection = assessmentTypes.includes("aptitude");

  return (
    <div className="container">
      <div className="card">
        <div style={{ marginBottom: "2rem" }}>
          <Link href="/dashboard" style={{ color: "#3b82f6", textDecoration: "none" }}>
            ← Back to Dashboard
          </Link>
        </div>

        <h1 style={{ marginBottom: "0.5rem" }}>Create New Assessment</h1>
        <p style={{ color: "#475569", marginBottom: "2rem" }}>
          Choose the type of assessment you want to create. You can select Aptitude, Technical, or both.
        </p>

        {error && (
          <div className="alert alert-error" style={{ marginBottom: "1.5rem" }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {/* Assessment Type Selection */}
          <div style={{ marginBottom: "2rem", padding: "1.5rem", backgroundColor: "#f8fafc", borderRadius: "0.75rem" }}>
            <label style={{ display: "block", marginBottom: "1rem", fontWeight: 600, color: "#1e293b", fontSize: "1.125rem" }}>
              Assessment Type *
            </label>
            <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  cursor: "pointer",
                  padding: "0.75rem",
                  borderRadius: "0.5rem",
                  backgroundColor: assessmentTypes.includes("aptitude") ? "#eff6ff" : "#ffffff",
                  border: `2px solid ${assessmentTypes.includes("aptitude") ? "#3b82f6" : "#e2e8f0"}`,
                }}
              >
                <input
                  type="checkbox"
                  checked={assessmentTypes.includes("aptitude")}
                  onChange={(e) => handleAssessmentTypeChange("aptitude", e.target.checked)}
                  style={{ width: "1.25rem", height: "1.25rem", cursor: "pointer" }}
                />
                <span style={{ fontWeight: 500, color: "#1e293b" }}>Aptitude</span>
              </label>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  cursor: "pointer",
                  padding: "0.75rem",
                  borderRadius: "0.5rem",
                  backgroundColor: assessmentTypes.includes("technical") ? "#eff6ff" : "#ffffff",
                  border: `2px solid ${assessmentTypes.includes("technical") ? "#3b82f6" : "#e2e8f0"}`,
                }}
              >
                <input
                  type="checkbox"
                  checked={assessmentTypes.includes("technical")}
                  onChange={(e) => handleAssessmentTypeChange("technical", e.target.checked)}
                  style={{ width: "1.25rem", height: "1.25rem", cursor: "pointer" }}
                />
                <span style={{ fontWeight: 500, color: "#1e293b" }}>Technical</span>
              </label>
            </div>
          </div>

          {/* Aptitude Configuration Section */}
          {showAptitudeSection && (
            <div style={{ marginBottom: "2rem", padding: "1.5rem", border: "1px solid #e2e8f0", borderRadius: "0.75rem" }}>
              <h2 style={{ marginBottom: "1rem", fontSize: "1.25rem", color: "#0f172a" }}>Aptitude Configuration</h2>
              <p style={{ color: "#64748b", marginBottom: "1.5rem", fontSize: "0.875rem" }}>
                Select aptitude categories and configure difficulty level and number of questions for each.
              </p>

              {APTITUDE_CATEGORIES.map((category) => {
                const categoryState = aptitudeConfig[category.key];
                return (
                  <div
                    key={category.key}
                    style={{
                      marginBottom: "1.5rem",
                      padding: "1rem",
                      backgroundColor: categoryState.enabled ? "#f8fafc" : "#ffffff",
                      border: `1px solid ${categoryState.enabled ? "#3b82f6" : "#e2e8f0"}`,
                      borderRadius: "0.5rem",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", marginBottom: "1rem" }}>
                      <input
                        type="checkbox"
                        checked={categoryState.enabled}
                        onChange={(e) => handleAptitudeCategoryChange(category.key, "enabled", e.target.checked)}
                        style={{ width: "1.25rem", height: "1.25rem", marginRight: "0.75rem", cursor: "pointer" }}
                      />
                      <label style={{ fontWeight: 600, color: "#1e293b", fontSize: "1rem", cursor: "pointer", flex: 1 }}>
                        {category.label}
                      </label>
                    </div>

                    {categoryState.enabled && (
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem", marginLeft: "2rem" }}>
                        <div>
                          <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500, color: "#475569", fontSize: "0.875rem" }}>
                            Difficulty
                          </label>
                          <select
                            value={categoryState.difficulty}
                            onChange={(e) => handleAptitudeCategoryChange(category.key, "difficulty", e.target.value)}
                            style={{
                              width: "100%",
                              padding: "0.75rem",
                              border: "1px solid #e2e8f0",
                              borderRadius: "0.5rem",
                              fontSize: "0.875rem",
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
                        <div>
                          <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500, color: "#475569", fontSize: "0.875rem" }}>
                            Number of Questions *
                          </label>
                          <input
                            type="number"
                            min="1"
                            max="50"
                            value={categoryState.numQuestions || ""}
                            onFocus={(e) => e.target.select()}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val === "" || val === null || val === undefined) {
                                handleAptitudeCategoryChange(category.key, "numQuestions", 0);
                              } else {
                                const num = parseInt(val, 10);
                                if (!isNaN(num) && num >= 0) {
                                  handleAptitudeCategoryChange(category.key, "numQuestions", num);
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
                            placeholder="Enter number"
                            required={categoryState.enabled}
                            style={{
                              width: "100%",
                              padding: "0.75rem",
                              border: "1px solid #e2e8f0",
                              borderRadius: "0.5rem",
                              fontSize: "0.875rem",
                            }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Technical Configuration Section */}
          {showTechnicalSection && (
            <div style={{ marginBottom: "2rem", padding: "1.5rem", border: "1px solid #e2e8f0", borderRadius: "0.75rem" }}>
              <h2 style={{ marginBottom: "1rem", fontSize: "1.25rem", color: "#0f172a" }}>Technical Configuration</h2>
              <p style={{ color: "#64748b", marginBottom: "1.5rem", fontSize: "0.875rem" }}>
                Enter the job details below. Our AI will generate relevant technical topics for your assessment.
              </p>

              <div style={{ marginBottom: "1.5rem" }}>
                <label htmlFor="numTopics" style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500, color: "#1e293b" }}>
                  Number of Topics *
                </label>
                <input
                  id="numTopics"
                  type="number"
                  min="1"
                  value={numTopics === "" ? "" : numTopics}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === "" || val === null || val === undefined) {
                      setNumTopics("");
                    } else {
                      const num = parseInt(val, 10);
                      if (!isNaN(num) && num >= 1) {
                        setNumTopics(num);
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
                  placeholder="e.g., 3, 5, 10"
                  required={showTechnicalSection}
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
                <label htmlFor="jobRole" style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500, color: "#1e293b" }}>
                  Job Role *
                </label>
                <input
                  id="jobRole"
                  type="text"
                  value={jobRole}
                  onChange={(e) => setJobRole(e.target.value)}
                  placeholder="e.g., Python Developer, Frontend Engineer, Data Scientist"
                  required={showTechnicalSection}
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
                <label htmlFor="experience" style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500, color: "#1e293b" }}>
                  Experience Level *
                </label>
                <select
                  id="experience"
                  value={experience}
                  onChange={(e) => setExperience(e.target.value)}
                  required={showTechnicalSection}
                  style={{
                    width: "100%",
                    padding: "0.75rem",
                    border: "1px solid #e2e8f0",
                    borderRadius: "0.5rem",
                    fontSize: "1rem",
                    backgroundColor: "#ffffff",
                  }}
                >
                  <option value="">Select experience level</option>
                  {EXPERIENCE_LEVELS.map((level) => (
                    <option key={level} value={level}>
                      {level}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ marginBottom: "1.5rem" }}>
                <label htmlFor="skills" style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500, color: "#1e293b" }}>
                  Key Skills * (Add at least one skill)
                </label>
                <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem" }}>
                  <input
                    id="skills"
                    type="text"
                    value={currentSkill}
                    onChange={(e) => setCurrentSkill(e.target.value)}
                    onKeyPress={handleKeyPress}
                    placeholder="e.g., Python, React, MongoDB"
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
                    onClick={handleAddSkill}
                    className="btn-secondary"
                    disabled={!currentSkill.trim()}
                  >
                    Add
                  </button>
                </div>
                {skills.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
                    {skills.map((skill) => (
                      <span
                        key={skill}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "0.5rem",
                          backgroundColor: "#eff6ff",
                          color: "#1e40af",
                          padding: "0.5rem 0.75rem",
                          borderRadius: "0.5rem",
                          fontSize: "0.875rem",
                          fontWeight: 500,
                        }}
                      >
                        {skill}
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
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: "1rem", marginTop: "2rem" }}>
            <button
              type="submit"
              className="btn-primary"
              disabled={loading || assessmentTypes.length === 0}
            >
              {loading ? "Generating Topics..." : "Generate Topics"}
            </button>
            <Link href="/dashboard">
              <button type="button" className="btn-secondary">
                Cancel
              </button>
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
