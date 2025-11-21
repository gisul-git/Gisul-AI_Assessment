import { useEffect, useState } from "react";
import { useRouter } from "next/router";

export default function AssessmentInstructionsPage() {
  const router = useRouter();
  const { id, token } = router.query;
  const [acknowledged, setAcknowledged] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [isCheckingSession, setIsCheckingSession] = useState(true);

  useEffect(() => {
    const storedEmail = sessionStorage.getItem("candidateEmail");
    const storedName = sessionStorage.getItem("candidateName");
    setEmail(storedEmail);
    setName(storedName);

    if (!storedEmail || !storedName) {
      if (id && token) {
        router.replace(`/assessment/${id}/${token}`);
      }
    } else {
      setIsCheckingSession(false);
    }
  }, [id, token, router]);

  const handleStart = () => {
    if (!acknowledged || !id || !token) return;
    router.push(`/assessment/${id}/${token}/take`);
  };

  if (isCheckingSession) {
    return null;
  }

  return (
    <div style={{ backgroundColor: "#f7f3e8", minHeight: "100vh", padding: "2rem" }}>
      <div style={{ maxWidth: "900px", margin: "0 auto" }}>
        <div className="card" style={{ padding: "2rem" }}>
          <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
            <p style={{ margin: 0, color: "#6b7280", fontSize: "0.9rem" }}>Candidate</p>
            <h1 style={{ fontSize: "2rem", fontWeight: 700, color: "#1f2937" }}>
              Assessment Instructions
            </h1>
            {email && name && (
              <p style={{ color: "#4b5563", marginTop: "0.5rem" }}>
                {name} ({email})
              </p>
            )}
          </div>

          <div style={{ display: "grid", gap: "1.5rem", marginBottom: "2rem" }}>
            <InstructionCard
              title="General Guidelines"
              bullets={[
                "Ensure a stable internet connection and a quiet environment.",
                "Do not refresh or close the browser tab during the assessment.",
                "Each section may have its own timer—keep an eye on the countdown.",
              ]}
            />
            <InstructionCard
              title="Answering Questions"
              bullets={[
                "Read each question carefully before responding.",
                "For descriptive questions, type answers in your own words. Copy/paste is disabled.",
                "Multiple-choice questions allow only one selection; ensure you click the correct option.",
              ]}
            />
            <InstructionCard
              title="Submission Rules"
              bullets={[
                "You must submit each section before proceeding to the next.",
                "If time expires, remaining answers will be auto-submitted.",
                "Use the navigation controls to move between questions in the current section.",
              ]}
            />
            <InstructionCard
              title="Code of Conduct"
              bullets={[
                "Any attempt to switch tabs, copy content, or seek unauthorized help may disqualify your attempt.",
                "Keep your webcam and microphone ready if proctoring is enabled.",
                "Contact the assessment administrator immediately if you face technical issues.",
              ]}
            />
          </div>

          <div style={{ marginBottom: "1.5rem" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.75rem", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                style={{ width: "1.25rem", height: "1.25rem" }}
              />
              <span style={{ fontSize: "0.95rem", color: "#1f2937" }}>
                I have read and understood the instructions, and I agree to follow the assessment rules.
              </span>
            </label>
          </div>

          <button
            type="button"
            className="btn-primary"
            onClick={handleStart}
            disabled={!acknowledged}
            style={{
              width: "100%",
              padding: "0.85rem",
              fontSize: "1rem",
              opacity: acknowledged ? 1 : 0.6,
              cursor: acknowledged ? "pointer" : "not-allowed",
            }}
          >
            Start Assessment
          </button>
        </div>
      </div>
    </div>
  );
}

function InstructionCard({ title, bullets }: { title: string; bullets: string[] }) {
  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: "0.75rem",
        padding: "1.25rem",
        backgroundColor: "#ffffff",
      }}
    >
      <h2 style={{ fontSize: "1.1rem", fontWeight: 600, color: "#1f2937", marginBottom: "0.75rem" }}>
        {title}
      </h2>
      <ul style={{ margin: 0, paddingLeft: "1.25rem", color: "#4b5563", lineHeight: 1.6 }}>
        {bullets.map((item, idx) => (
          <li key={idx} style={{ marginBottom: "0.5rem" }}>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

