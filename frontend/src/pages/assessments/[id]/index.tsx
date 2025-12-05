import { useEffect } from "react";
import { useRouter } from "next/router";
import { GetServerSideProps } from "next";
import { requireAuth } from "../../../lib/auth";
import axios from "axios";

export default function AssessmentDetailPage() {
  const router = useRouter();
  const { id } = router.query;

  useEffect(() => {
    if (id && typeof id === 'string') {
      // Redirect to dashboard or create-new based on assessment status
      fetchAssessmentAndRedirect(id);
    }
  }, [id]);

  const fetchAssessmentAndRedirect = async (assessmentId: string) => {
    try {
      const response = await axios.get(`/api/assessments/get-questions?assessmentId=${assessmentId}`);
      if (response.data?.success && response.data?.data) {
        const assessment = response.data.data;
        const status = assessment.assessment?.status || 'draft';
        
        // Redirect based on status
        if (status === 'draft') {
          router.replace(`/assessments/create-new?id=${assessmentId}`);
        } else {
          router.replace('/dashboard');
        }
      } else {
        // If assessment not found, redirect to dashboard
        router.replace('/dashboard');
      }
    } catch (err: any) {
      console.error("Error fetching assessment:", err);
      // On error, redirect to dashboard
      router.replace('/dashboard');
    }
  };

  return (
    <div className="container">
      <div className="card">
        <p style={{ textAlign: "center", color: "#475569" }}>Redirecting...</p>
      </div>
    </div>
  );
}

// Server-side authentication check
export const getServerSideProps: GetServerSideProps = requireAuth;
