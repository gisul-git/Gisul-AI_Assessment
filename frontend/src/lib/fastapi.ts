import axios from "axios";

const fastApiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000",
  headers: {
    "Content-Type": "application/json",
  },
  timeout: 120000, // 120 seconds (2 minutes) timeout - increased for slow backend responses
});

fastApiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    // Extract error message from different possible response structures
    let message = error.message;
    
    if (error.response?.data) {
      // Try different possible error message fields
      message = error.response.data.detail || 
                error.response.data.message || 
                error.response.data.error ||
                error.response.data.msg ||
                error.message;
      
      // Handle array of messages
      if (Array.isArray(message)) {
        message = message.join(", ");
      }
    }
    
    return Promise.reject(new Error(message || "An error occurred. Please try again."));
  },
);

export default fastApiClient;
