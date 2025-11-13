import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import axios from "axios";
import Image from "next/image";
import Link from "next/link";
import fastApiClient from "@/lib/fastapi";

interface StatusMessage {
  type: "success" | "error";
  text: string;
}

export default function SuperAdminSignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<StatusMessage | null>(null);
  const [showVerification, setShowVerification] = useState(false);
  const [verificationCode, setVerificationCode] = useState("");
  const [sendingCode, setSendingCode] = useState(false);
  const [verifyingCode, setVerifyingCode] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
  const [codeExpired, setCodeExpired] = useState(false);

  const showMessage = (type: StatusMessage["type"], text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 6000);
  };

  // Countdown timer effect
  useEffect(() => {
    if (!showVerification || timeRemaining === null) return;

    if (timeRemaining <= 0) {
      setCodeExpired(true);
      setTimeRemaining(0);
      return;
    }

    const timer = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev === null || prev <= 1) {
          setCodeExpired(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [showVerification, timeRemaining]);

  const handleSendVerificationCode = async () => {
    setSendingCode(true);
    setMessage(null);
    setCodeExpired(false);
    try {
      await axios.post("/api/auth/send-verification-code", { email });
      setMessage({ type: "success", text: "Verification code sent successfully" });
      setTimeRemaining(60);
    } catch (err: any) {
      const errorMessage = err.response?.data?.message || err.message || "Failed to send verification code";
      setMessage({ type: "error", text: errorMessage });
    } finally {
      setSendingCode(false);
    }
  };

  const handleVerifyCode = async () => {
    if (!verificationCode || verificationCode.length < 4) {
      setMessage({ type: "error", text: "Please enter a valid 6-digit verification code" });
      return;
    }

    if (codeExpired) {
      setMessage({ type: "error", text: "Verification code has expired. Please request a new code." });
      return;
    }

    setVerifyingCode(true);
    setMessage(null);
    try {
      await axios.post("/api/auth/verify-email-code", {
        email,
        code: verificationCode,
      });
      // Verification successful, redirect to sign in page
      setMessage({ type: "success", text: "Email verified successfully! Redirecting to sign in..." });
      setTimeout(() => {
        router.push("/auth/super-admin");
      }, 1500);
    } catch (err: any) {
      let errorMessage = err.response?.data?.message || err.message || "Invalid verification code";
      
      // Only set codeExpired if the error explicitly says "expired"
      if (errorMessage.toLowerCase().includes("expired") && !errorMessage.toLowerCase().includes("invalid")) {
        errorMessage = "Verification code has expired. Please request a new code.";
        setCodeExpired(true);
      } else if (errorMessage.includes("Invalid") || errorMessage.includes("invalid") || errorMessage.includes("incorrect")) {
        errorMessage = "Invalid verification code. Please check and try again.";
        // Don't set codeExpired for invalid codes - only for expired codes
      } else if (errorMessage.includes("not found") || errorMessage.includes("User not found")) {
        errorMessage = "User not found. Please sign up again.";
      }
      
      setMessage({ type: "error", text: errorMessage });
    } finally {
      setVerifyingCode(false);
    }
  };

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (password !== confirmPassword) {
      showMessage("error", "Passwords do not match");
      return;
    }

    try {
      setLoading(true);
      setMessage(null);
      const { data } = await axios.post("/api/auth/superadmin-signup", {
        name,
        email,
        password,
      });
      // Signup successful, show verification screen
      setShowVerification(true);
      setMessage({
        type: "success",
        text: "Please check your email for verification code.",
      });
      setTimeRemaining(60);
      setCodeExpired(false);
    } catch (error: any) {
      showMessage("error", error?.response?.data?.message ?? error?.message ?? "Signup failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container" style={{ maxWidth: "560px" }}>
      <div style={{ textAlign: "center", marginBottom: "2rem" }}>
        <Image src="/logo.svg" alt="AI Assessment" width={72} height={72} />
        <h1>Create Super Admin</h1>
        <p style={{ color: "#475569" }}>
          Set up the first super admin account to manage the entire platform.
        </p>
      </div>

      <div className="card">
        {!showVerification ? (
          <>
            <form onSubmit={onSubmit}>
              <label htmlFor="name">Full Name</label>
              <input
                id="name"
                type="text"
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
              />

              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />

              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />

              <label htmlFor="confirmPassword">Confirm Password</label>
              <input
                id="confirmPassword"
                type="password"
                required
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />

              <button type="submit" className="btn-primary" disabled={loading}>
                {loading ? "Creating..." : "Create Super Admin"}
              </button>
            </form>

            {message && (
              <div className={`alert ${message.type === "success" ? "alert-success" : "alert-error"}`}>
                {message.text}
              </div>
            )}
          </>
        ) : (
          <div>
            <h2 style={{ marginTop: 0, marginBottom: "1rem" }}>Email Verification Required</h2>
            <p style={{ color: "#475569", marginBottom: "1.5rem" }}>
              We&apos;ve sent a verification code to <strong>{email}</strong>. Please enter the code below to verify your email.
            </p>

            <label htmlFor="verificationCode">Verification Code</label>
            <input
              id="verificationCode"
              type="text"
              required
              maxLength={10}
              placeholder="Enter 6-digit code"
              value={verificationCode}
              onChange={(event) => {
                setVerificationCode(event.target.value.replace(/\D/g, ""));
                // Reset codeExpired when user starts typing a new code
                if (codeExpired) {
                  setCodeExpired(false);
                }
              }}
              style={{ textAlign: "center", fontSize: "1.25rem", letterSpacing: "0.5rem" }}
            />
            
            {timeRemaining !== null && (
              <div style={{ marginTop: "0.75rem", textAlign: "center" }}>
                {codeExpired ? (
                  <p style={{ color: "#ef4444", fontSize: "0.875rem", fontWeight: 500 }}>
                    Code expired. Please request a new code.
                  </p>
                ) : (
                  <p style={{ color: "#475569", fontSize: "0.875rem" }}>
                    Code expires in{" "}
                    <strong style={{ color: timeRemaining < 60 ? "#ef4444" : "#2563eb" }}>
                      {Math.floor(timeRemaining / 60)}:{(timeRemaining % 60).toString().padStart(2, "0")}
                    </strong>
                  </p>
                )}
              </div>
            )}

            {message && (
              <div className={`alert ${message.type === "success" ? "alert-success" : "alert-error"}`} style={{ marginTop: "1rem" }}>
                {message.text}
              </div>
            )}

            <div style={{ display: "flex", gap: "0.75rem", marginTop: "1.5rem" }}>
              <button
                type="button"
                className="btn-primary"
                onClick={handleVerifyCode}
                disabled={verifyingCode || !verificationCode}
                style={{ flex: 1 }}
              >
                {verifyingCode ? "Verifying..." : "Verify Code"}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={handleSendVerificationCode}
                disabled={sendingCode}
              >
                {sendingCode ? "Sending..." : "Resend Code"}
              </button>
            </div>
          </div>
        )}
      </div>

      <div style={{ marginTop: "1.5rem", textAlign: "center", color: "#475569" }}>
        <p>
          Already have credentials?{" "}
          <Link href="/auth/super-admin" style={{ color: "#2563EB", fontWeight: 600 }}>
            Go to super admin sign-in
          </Link>
        </p>
      </div>
    </div>
  );
}
