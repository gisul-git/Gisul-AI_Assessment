import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { GetServerSideProps } from "next";
import { requireAuth } from "../../../../lib/auth";
import axios from "axios";

interface Question {
  id: string;
  title: string;
  difficulty: string;
}

export default function EditDSATestPage() {
  const router = useRouter();
  const { id: testId } = router.query;
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [questions, setQuestions] = useState<Question[]>([]);
  
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    question_ids: [] as string[],
    duration_minutes: 60,
    start_time: "",
    end_time: "",
  });

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  useEffect(() => {
    if (testId) {
      fetchTestData();
      fetchQuestions();
    }
  }, [testId]);

  const fetchTestData = async () => {
    try {
      const response = await axios.get(`${apiUrl}/api/dsa/tests/${testId}`);
      const test = response.data;
      
      // Format dates for datetime-local input
      const startTime = test.start_time ? new Date(test.start_time).toISOString().slice(0, 16) : "";
      const endTime = test.end_time ? new Date(test.end_time).toISOString().slice(0, 16) : "";
      
      setFormData({
        title: test.title || "",
        description: test.description || "",
        question_ids: test.question_ids || [],
        duration_minutes: test.duration_minutes || 60,
        start_time: startTime,
        end_time: endTime,
      });
      setFetching(false);
    } catch (error) {
      console.error("Error fetching test:", error);
      alert("Failed to load test data");
      router.push("/dsa/tests");
    }
  };

  const fetchQuestions = async () => {
    try {
      const response = await axios.get(`${apiUrl}/api/dsa/questions/`);
      setQuestions(response.data);
    } catch (error) {
      console.error("Error fetching questions:", error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      await axios.put(`${apiUrl}/api/dsa/tests/${testId}`, {
        ...formData,
        start_time: new Date(formData.start_time).toISOString(),
        end_time: new Date(formData.end_time).toISOString(),
      });
      // Add a query parameter to trigger refresh
      router.push("/dsa/tests?refreshed=true");
    } catch (error: any) {
      alert(error.response?.data?.detail || error.response?.data?.message || "Failed to update DSA competency test");
      setLoading(false);
    }
  };

  const toggleQuestion = (questionId: string) => {
    if (formData.question_ids.includes(questionId)) {
      setFormData({
        ...formData,
        question_ids: formData.question_ids.filter((id) => id !== questionId),
      });
    } else {
      setFormData({
        ...formData,
        question_ids: [...formData.question_ids, questionId],
      });
    }
  };

  const handleDeleteQuestion = async (questionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    if (!confirm('Are you sure you want to delete this question? This action cannot be undone.')) {
      return;
    }

    try {
      await axios.delete(`${apiUrl}/api/dsa/questions/${questionId}`);
      
      // Remove from selected questions if it was selected
      if (formData.question_ids.includes(questionId)) {
        setFormData({
          ...formData,
          question_ids: formData.question_ids.filter((id) => id !== questionId),
        });
      }
      
      // Refresh questions list
      await fetchQuestions();
      alert('Question deleted successfully!');
    } catch (error: any) {
      alert(error.response?.data?.detail || error.response?.data?.message || 'Failed to delete question');
    }
  };

  if (fetching) {
    return (
      <div style={{ backgroundColor: "#ffffff", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div>Loading test data...</div>
      </div>
    );
  }

  return (
    <div style={{ backgroundColor: "#ffffff", minHeight: "100vh" }}>
      <div className="container" style={{ paddingTop: "2rem", paddingBottom: "2rem" }}>
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
            ← Back
          </button>
        </div>

        <div className="card">
          <h1 style={{ marginBottom: "2rem", color: "#1a1625" }}>Edit DSA Competency Test</h1>
          
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: "1.5rem" }}>
              <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600 }}>
                Test Title *
              </label>
              <input
                type="text"
                required
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                style={{
                  width: "100%",
                  padding: "0.75rem",
                  border: "1px solid #A8E8BC",
                  borderRadius: "0.375rem",
                }}
                placeholder="e.g., Data Structures and Algorithms Assessment"
              />
            </div>

            <div style={{ marginBottom: "1.5rem" }}>
              <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600 }}>
                Description
              </label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                style={{
                  width: "100%",
                  padding: "0.75rem",
                  border: "1px solid #A8E8BC",
                  borderRadius: "0.375rem",
                  minHeight: "100px",
                }}
                placeholder="Describe the test..."
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem", marginBottom: "1.5rem" }}>
              <div>
                <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600 }}>
                  Duration (minutes) *
                </label>
                <input
                  type="number"
                  required
                  min="1"
                  value={formData.duration_minutes}
                  onChange={(e) => setFormData({ ...formData, duration_minutes: parseInt(e.target.value) })}
                  style={{
                    width: "100%",
                    padding: "0.75rem",
                    border: "1px solid #A8E8BC",
                    borderRadius: "0.375rem",
                  }}
                />
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600 }}>
                  Start Time *
                </label>
                <input
                  type="datetime-local"
                  required
                  value={formData.start_time}
                  onChange={(e) => setFormData({ ...formData, start_time: e.target.value })}
                  style={{
                    width: "100%",
                    padding: "0.75rem",
                    border: "1px solid #A8E8BC",
                    borderRadius: "0.375rem",
                  }}
                />
              </div>
              <div>
                <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600 }}>
                  End Time *
                </label>
                <input
                  type="datetime-local"
                  required
                  value={formData.end_time}
                  onChange={(e) => setFormData({ ...formData, end_time: e.target.value })}
                  style={{
                    width: "100%",
                    padding: "0.75rem",
                    border: "1px solid #A8E8BC",
                    borderRadius: "0.375rem",
                  }}
                />
              </div>
            </div>

            <div style={{ marginBottom: "1.5rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                <label style={{ fontWeight: 600 }}>Select Questions *</label>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => router.push("/dsa/questions/create")}
                  style={{ padding: "0.5rem 1rem", fontSize: "0.875rem" }}
                >
                  + Create Question
                </button>
              </div>

              {questions.length === 0 ? (
                <div style={{ padding: "2rem", border: "1px solid #A8E8BC", borderRadius: "0.375rem", textAlign: "center", color: "#2D7A52" }}>
                  <p>No questions available. Create a question using the button above.</p>
                </div>
              ) : (
                <>
                  <div style={{ border: "1px solid #A8E8BC", borderRadius: "0.375rem", padding: "1rem", maxHeight: "400px", overflowY: "auto" }}>
                    {questions.map((q) => (
                      <div
                        key={q.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "0.75rem",
                          padding: "0.75rem",
                          marginBottom: "0.5rem",
                          border: formData.question_ids.includes(q.id) ? "2px solid #2D7A52" : "1px solid #E8FAF0",
                          borderRadius: "0.375rem",
                          cursor: "pointer",
                          backgroundColor: formData.question_ids.includes(q.id) ? "#E8FAF0" : "#ffffff",
                        }}
                        onClick={() => toggleQuestion(q.id)}
                      >
                        <input
                          type="checkbox"
                          checked={formData.question_ids.includes(q.id)}
                          onChange={() => toggleQuestion(q.id)}
                        />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 600, color: "#1a1625" }}>{q.title}</div>
                          <div style={{ fontSize: "0.875rem", color: "#2D7A52", textTransform: "capitalize" }}>
                            {q.difficulty}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => handleDeleteQuestion(q.id, e)}
                          style={{
                            padding: "0.5rem",
                            border: "none",
                            backgroundColor: "transparent",
                            color: "#ef4444",
                            cursor: "pointer",
                            fontSize: "1.25rem",
                          }}
                        >
                          🗑️
                        </button>
                      </div>
                    ))}
                  </div>
                  <p style={{ fontSize: "0.875rem", color: "#2D7A52", marginTop: "0.5rem" }}>
                    Selected: {formData.question_ids.length} questions
                  </p>
                </>
              )}
            </div>

            <div style={{ display: "flex", gap: "1rem", marginTop: "2rem" }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => router.push("/dsa/tests")}
                style={{ flex: 1 }}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn-primary"
                disabled={loading || formData.question_ids.length === 0}
                style={{ flex: 1 }}
              >
                {loading ? "Updating..." : "Update DSA Competency Test"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export const getServerSideProps: GetServerSideProps = requireAuth;

