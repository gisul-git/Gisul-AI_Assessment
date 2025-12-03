import axios from 'axios'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export const dsaApi = axios.create({
  baseURL: `${API_URL}/api/dsa`,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Add token to requests if available
dsaApi.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    // Try to get token from NextAuth session first, fallback to localStorage
    const getToken = async () => {
      try {
        // Check if NextAuth is available
        const { getSession } = await import('next-auth/react')
        const session = await getSession()
        if (session?.backendToken) {
          return session.backendToken
        }
      } catch (e) {
        // NextAuth not available, use localStorage
      }
      return localStorage.getItem('token')
    }
    
    // For now, use localStorage token (will be updated when session is available)
    const token = localStorage.getItem('token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
  }
  return config
})

// Handle 401 errors (unauthorized)
dsaApi.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Clear auth data and redirect to login
      if (typeof window !== 'undefined') {
        localStorage.removeItem('token')
        localStorage.removeItem('user')
        window.location.href = '/auth/signin'
      }
    }
    return Promise.reject(error)
  }
)

export default dsaApi

