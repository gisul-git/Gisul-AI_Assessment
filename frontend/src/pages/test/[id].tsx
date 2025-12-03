import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/router'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/dsa/ui/card'
import { Button } from '../../components/dsa/ui/button'
import { Input } from '../../components/dsa/ui/input'
import dsaApi from '../../lib/dsa/api'
import { AlertCircle } from 'lucide-react'

export default function TestPage() {
  const router = useRouter()
  const { id: testId } = router.query
  const [token, setToken] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState('')
  const [userInfo, setUserInfo] = useState<{user_id: string, name: string, email: string} | null>(null)
  const [test, setTest] = useState<{test_id: string, test_title: string, test_description: string, valid: boolean} | null>(null)
  const verifyingRef = useRef(false)

  // Get token from URL
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search)
      const tokenFromUrl = urlParams.get('token')
      if (tokenFromUrl) {
        setToken(tokenFromUrl)
      }
    }
  }, [])

  // Verify the shared test link token only once
  useEffect(() => {
    if (verifyingRef.current || !testId || !token) return
    
    verifyingRef.current = true
    
    // Verify the shared test link token
    const verifyLink = async () => {
      try {
        const response = await dsaApi.get(`/tests/${testId}/verify-link?token=${encodeURIComponent(token)}`)
        if (response.data.valid) {
          // Token is valid, but we need candidate to enter their email/name
          setTest(response.data)
          setError('') // Clear any previous errors
        } else {
          setError('Invalid test link')
          verifyingRef.current = false
        }
      } catch (err: any) {
        setError(err.response?.data?.detail || 'Invalid test link')
        verifyingRef.current = false // Allow retry on error
      }
    }

    verifyLink()
  }, [testId, token])

  const handleVerify = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    e.stopPropagation()
    
    if (verifying) return // Prevent double submission
    
    setVerifying(true)
    setError('')

    try {
      if (!name.trim() || !email.trim()) {
        setError('Please enter both name and email')
        setVerifying(false)
        return
      }

      // Verify candidate email/name with shared link
      const verifyResponse = await dsaApi.post(
        `/tests/${testId}/verify-candidate?email=${encodeURIComponent(email.trim())}&name=${encodeURIComponent(name.trim())}`
      )
      
      const candidateInfo = verifyResponse.data
      setUserInfo({
        user_id: candidateInfo.user_id,
        name: candidateInfo.name,
        email: candidateInfo.email
      })

      // Store candidate info in sessionStorage for precheck/instructions pages
      // Note: Test details will be fetched in precheck/instructions pages, no need to fetch here
      sessionStorage.setItem("candidateEmail", email.trim())
      sessionStorage.setItem("candidateName", name.trim())
      sessionStorage.setItem("candidateUserId", candidateInfo.user_id)
      
      // Redirect to precheck page first (don't start test yet - will start after instructions)
      router.push(`/test/${testId}/precheck?token=${encodeURIComponent(token!)}&user_id=${encodeURIComponent(candidateInfo.user_id)}`)
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to verify candidate. Please check your name and email.')
      setVerifying(false)
    }
  }

  if (error && !test) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4" style={{ backgroundColor: '#0f172a' }}>
        <Card className="w-full max-w-md">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 text-destructive mb-4">
              <AlertCircle className="h-5 w-5" />
              <h2 className="text-lg font-semibold">Invalid Test Link</h2>
            </div>
            <p className="text-muted-foreground">{error}</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4" style={{ backgroundColor: '#0f172a' }}>
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle style={{ color: '#ffffff' }}>
            {test ? test.test_title : 'Verify Your Identity'}
          </CardTitle>
          {test && (
            <p className="text-sm text-muted-foreground mt-2" style={{ color: '#94a3b8' }}>
              {test.test_description}
            </p>
          )}
        </CardHeader>
        <CardContent>
          <form 
            onSubmit={handleVerify} 
            className="space-y-4"
            noValidate
          >
            <div>
              <label className="text-sm font-medium mb-2 block" style={{ color: '#e2e8f0' }}>Name</label>
              <Input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="Enter your name as registered"
                autoComplete="name"
                style={{
                  backgroundColor: '#1e293b',
                  color: '#ffffff',
                  borderColor: '#334155',
                }}
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block" style={{ color: '#e2e8f0' }}>Email</label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="Enter your email as registered"
                autoComplete="email"
                style={{
                  backgroundColor: '#1e293b',
                  color: '#ffffff',
                  borderColor: '#334155',
                }}
              />
            </div>
            {error && (
              <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
                {error}
              </div>
            )}
            <Button 
              type="submit"
              className="w-full" 
              disabled={verifying}
            >
              {verifying ? 'Verifying...' : 'Start Test'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

