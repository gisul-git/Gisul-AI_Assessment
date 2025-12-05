import { useEffect, useRef } from "react";
import { useRouter } from "next/router";
import { GetServerSideProps } from "next";
import { requireAuth } from "../../../lib/auth";
import axios from "axios";

export default function AssessmentDetailPage() {
  const router = useRouter();
  const { id } = router.query;
  const hasRedirectedRef = useRef(false);

  useEffect(() => {
    if (id && typeof id === 'string' && !hasRedirectedRef.current) {
      // Redirect to dashboard or create-new based on assessment status
      fetchAssessmentAndRedirect(id);
    }
  }, [id]);

  const fetchAssessmentAndRedirect = async (assessmentId: string) => {
    // Prevent multiple redirects
    if (hasRedirectedRef.current) return;
    
    try {
      const response = await axios.get(`/api/assessments/get-questions?assessmentId=${assessmentId}`);
      if (response.data?.success && response.data?.data) {
        const assessment = response.data.data;
        const status = assessment.assessment?.status || 'draft';
        
        hasRedirectedRef.current = true;
        
        // Redirect based on status
        if (status === 'draft') {
          router.replace(`/assessments/create-new?id=${assessmentId}`);
        } else {
          // Only redirect to dashboard if not already there
          const currentPath = router.asPath || router.pathname;
          if (currentPath !== '/dashboard') {
            router.replace('/dashboard');
          }
        }
      } else {
        // If assessment not found, redirect to dashboard (only if not already there)
        hasRedirectedRef.current = true;
        const currentPath = router.asPath || router.pathname;
        if (currentPath !== '/dashboard') {
          router.replace('/dashboard');
        }
      }
    } catch (err: any) {
      console.error("Error fetching assessment:", err);
      // On error, redirect to dashboard (only if not already there)
      hasRedirectedRef.current = true;
      const currentPath = router.asPath || router.pathname;
      if (currentPath !== '/dashboard') {
        router.replace('/dashboard');
      }
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
