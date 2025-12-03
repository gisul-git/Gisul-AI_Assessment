'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { Card, CardContent } from '../../../components/dsa/ui/card'
import { Button } from '../../../components/dsa/ui/button'
import dsaApi from '../../../lib/dsa/api'
import { Clock, Eye, EyeOff, Users, Mail, Trash2, Edit, Upload, BarChart3, List } from 'lucide-react'
import Link from 'next/link'
// Helper function to format dates
const formatDate = (dateString: string, formatStr: string) => {
  const date = new Date(dateString)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const month = months[date.getMonth()]
  const day = date.getDate()
  const year = date.getFullYear()
  const hours = date.getHours().toString().padStart(2, '0')
  const minutes = date.getMinutes().toString().padStart(2, '0')
  
  if (formatStr === 'MMM dd, yyyy HH:mm') {
    return `${month} ${day}, ${year} ${hours}:${minutes}`
  }
  return date.toLocaleDateString()
}

interface Test {
  id: string
  title: string
  description: string
  duration_minutes: number
  start_time: string
  end_time: string
  is_active: boolean
  is_published: boolean
  invited_users: string[]
  question_ids?: string[]
  test_token?: string
}

export default function TestsListPage() {
  const router = useRouter()
  const [tests, setTests] = useState<Test[]>([])
  const [loading, setLoading] = useState(true)
  const [inviteModal, setInviteModal] = useState<{ testId: string; open: boolean }>({ testId: '', open: false })
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const fetchTests = async () => {
    try {
      const response = await dsaApi.get('/tests/', {
        params: { active_only: false }
      })
      setTests(response.data)
    } catch (error) {
      console.error('Error fetching tests:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchTests()
  }, [])

  // Refresh when query parameter changes (e.g., returning from edit page)
  useEffect(() => {
    if (router.query.refreshed === 'true') {
      fetchTests()
      // Remove the query parameter
      router.replace('/dsa/tests', undefined, { shallow: true })
    }
  }, [router.query.refreshed])

  const handlePublish = async (testId: string, currentStatus: boolean) => {
    try {
      const newStatus = !currentStatus
      await dsaApi.patch(`/tests/${testId}/publish`, {
        is_published: newStatus
      })
      setTests(tests.map(t => 
        t.id === testId ? { ...t, is_published: newStatus } : t
      ))
      alert(`Test ${newStatus ? 'published' : 'unpublished'} successfully!`)
    } catch (error: any) {
      console.error('Publish error:', error)
      alert(error.response?.data?.detail || 'Failed to update publish status')
    }
  }

  const handleDelete = async (testId: string) => {
    if (!confirm('Are you sure you want to delete this test? This action cannot be undone. Note: Associated submissions and candidate records will remain in the database.')) {
      return
    }

    setDeletingId(testId)
    try {
      await dsaApi.delete(`/tests/${testId}`)
      setTests(tests.filter((t) => t.id !== testId))
      alert('Test deleted successfully!')
    } catch (error: any) {
      alert(error.response?.data?.detail || 'Failed to delete test')
    } finally {
      setDeletingId(null)
    }
  }

  const [candidateName, setCandidateName] = useState('')
  const [candidateEmail, setCandidateEmail] = useState('')
  const [addingCandidate, setAddingCandidate] = useState(false)
  const [generatedLink, setGeneratedLink] = useState<{testId: string, link: string, name: string, email: string} | null>(null)

  const handleAddCandidate = async (testId: string) => {
    if (!candidateName.trim() || !candidateEmail.trim()) {
      alert('Please enter both name and email')
      return
    }

    setAddingCandidate(true)
    try {
      const response = await dsaApi.post(`/tests/${testId}/add-candidate`, {
        test_id: testId,
        name: candidateName,
        email: candidateEmail,
      })
      
      // Candidate added successfully (no unique link - using shared link)
      setGeneratedLink({
        testId: testId,
        link: '', // Not used anymore - shared link shown in test card
        name: response.data.name,
        email: response.data.email
      })
      
      // Don't refresh tests immediately - keep modal open to show link
      // Refresh will happen when modal is closed
      // const testsRes = await api.get('/tests/?active_only=false')
      // setTests(testsRes.data)
    } catch (error: any) {
      alert(error.response?.data?.detail || 'Failed to add candidate')
    } finally {
      setAddingCandidate(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="container mx-auto px-4 py-8">
          <div className="text-center">Loading...</div>
        </div>
      </div>
    )
  }

  return (
   <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8">
        {/* Back Button */}
        <div style={{ marginBottom: "1.5rem" }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => router.push("/dsa")}
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

        <div className="mb-6">
          <h1 className="text-4xl font-bold">Test Management</h1>
          <p className="text-muted-foreground mt-1">Publish tests and add candidates to published tests</p>
        </div>

        {tests.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center">
              <p className="text-muted-foreground">No tests available. Create tests from the dashboard.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {tests.map((test) => (
              <Card key={test.id}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <h3 className="font-semibold text-lg">{test.title}</h3>
                      <p className="text-sm text-muted-foreground mt-1">{test.description}</p>
                      <div className="flex items-center gap-4 mt-2 text-sm">
                        <div className="flex items-center gap-1">
                          <Clock className="h-4 w-4" />
                          {test.duration_minutes} minutes
                        </div>
                        <div>
                          Start: {formatDate(test.start_time, 'MMM dd, yyyy HH:mm')}
                        </div>
                        <div>
                          End: {formatDate(test.end_time, 'MMM dd, yyyy HH:mm')}
                        </div>
                        <span
                          className={`px-2 py-1 rounded text-xs ${
                            test.is_active
                              ? 'bg-green-500/20 text-green-500'
                              : 'bg-gray-500/20 text-gray-500'
                          }`}
                        >
                          {test.is_active ? 'Active' : 'Inactive'}
                        </span>
                        <span
                          className={`px-2 py-1 rounded text-xs ${
                            test.is_published
                              ? 'bg-blue-500/20 text-blue-500'
                              : 'bg-gray-500/20 text-gray-500'
                          }`}
                        >
                          {test.is_published ? 'Published' : 'Draft'}
                        </span>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Users className="h-3 w-3" />
                          {test.invited_users?.length || 0} candidates
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {test.question_ids?.length || 0} questions
                        </div>
                      </div>
                      {test.is_published && test.test_token && (
                        <div className="mt-3 p-3 bg-blue-500/10 border border-blue-500/20 rounded-md">
                          <div className="text-xs font-medium text-blue-400 mb-2">Shared Test Link:</div>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={`${typeof window !== 'undefined' ? window.location.origin : ''}/test/${test.id}?token=${test.test_token}`}
                              readOnly
                              className="flex-1 p-2 border rounded-md bg-background text-xs font-mono"
                            />
                            <Button
                              size="sm"
                              onClick={async () => {
                                const link = `${window.location.origin}/test/${test.id}?token=${test.test_token}`
                                try {
                                  await navigator.clipboard.writeText(link)
                                  alert('Link copied to clipboard!')
                                } catch (err) {
                                  const input = document.createElement('input')
                                  input.value = link
                                  document.body.appendChild(input)
                                  input.select()
                                  document.execCommand('copy')
                                  document.body.removeChild(input)
                                  alert('Link copied to clipboard!')
                                }
                              }}
                            >
                              Copy
                            </Button>
                          </div>
                          <p className="text-xs text-muted-foreground mt-2">
                            Share this single link with all candidates. They will enter their email and name to verify.
                          </p>
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant={test.is_published ? "outline" : "default"}
                        size="sm"
                        onClick={() => handlePublish(test.id, test.is_published || false)}
                        disabled={!test.question_ids || test.question_ids.length === 0}
                        title={!test.question_ids || test.question_ids.length === 0 ? "Add questions to the test first" : test.is_published ? "Click to unpublish the test" : "Click to publish the test"}
                      >
                        {test.is_published ? (
                          <>
                            <EyeOff className="h-4 w-4 mr-2" />
                            Unpublish
                          </> 
                        ) : (
                          <>
                            <Eye className="h-4 w-4 mr-2" />
                            Publish
                          </>
                        )}
                      </Button>
                      <Link href={`/dsa/tests/${test.id}/edit`}>
                        <Button variant="outline" size="sm">
                          <Edit className="h-4 w-4 mr-2" />
                          Edit
                        </Button>
                      </Link>
                      <Link href={`/dsa/tests/${test.id}/candidates`}>
                        <Button variant="outline" size="sm" disabled={!test.is_published}>
                          <List className="h-4 w-4 mr-2" />
                          Candidates
                        </Button>
                      </Link>
                      <Link href={`/dsa/tests/${test.id}/analytics`}>
                        <Button variant="outline" size="sm" disabled={!test.is_published}>
                          <BarChart3 className="h-4 w-4 mr-2" />
                          Analytics
                        </Button>
                      </Link>
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => {
                          setInviteModal({ testId: test.id, open: true })
                          setGeneratedLink(null)
                          setCandidateName('')
                          setCandidateEmail('')
                        }}
                        disabled={!test.is_published}
                        title={!test.is_published ? "Publish the test first before adding candidates" : "Add a candidate and generate a unique test link"}
                      >
                        <Mail className="h-4 w-4 mr-2" />
                        Add Candidate
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleDelete(test.id)}
                        disabled={deletingId === test.id}
                        title="Delete this test"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        {deletingId === test.id ? 'Deleting...' : 'Delete'}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Add Candidate Modal */}
      {inviteModal.open && (
        <div 
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={(e) => {
            // Only close if clicking the backdrop, not the modal content
            if (e.target === e.currentTarget) {
              setInviteModal({ testId: '', open: false })
              setGeneratedLink(null)
              setCandidateName('')
              setCandidateEmail('')
            }
          }}
        >
          <Card className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <CardContent className="p-6">
              <h3 className="text-lg font-semibold mb-4">Add Candidate</h3>
              
              {/* CSV Upload Section */}
              <div className="mb-4 p-4 border rounded-md" style={{ backgroundColor: '#f8f9fa', borderColor: '#A8E8BC' }}>
                <h4 className="text-sm font-medium mb-2" style={{ color: '#1a1625' }}>Bulk Upload (CSV)</h4>
                <p className="text-xs mb-3" style={{ color: '#6b7280' }}>
                  Upload a CSV file with 'name' and 'email' columns
                </p>
                <input
                  type="file"
                  accept=".csv"
                  onChange={async (e) => {
                    const file = e.target.files?.[0]
                    if (!file) return
                    
                    const formData = new FormData()
                    formData.append('file', file)
                    
                    try {
                      const response = await dsaApi.post(
                        `/tests/${inviteModal.testId}/bulk-add-candidates`,
                        formData,
                        {
                          headers: {
                            'Content-Type': 'multipart/form-data',
                          },
                        }
                      )
                      
                      alert(
                        `Bulk upload completed!\n` +
                        `Success: ${response.data.success_count}\n` +
                        `Failed: ${response.data.failed_count}\n` +
                        `Duplicates: ${response.data.duplicate_count}`
                      )
                      
                      // Refresh tests
                      const testsRes = await dsaApi.get('/tests/', {
                        params: { active_only: false }
                      })
                      setTests(testsRes.data)
                      
                      // Reset file input
                      e.target.value = ''
                    } catch (error: any) {
                      alert(error.response?.data?.detail || 'Failed to upload CSV')
                      e.target.value = ''
                    }
                  }}
                  className="text-sm"
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    border: '1px solid #A8E8BC',
                    borderRadius: '0.375rem',
                    backgroundColor: '#ffffff',
                    cursor: 'pointer'
                  }}
                />
              </div>
              
              {generatedLink && generatedLink.testId === inviteModal.testId ? (
                <div className="space-y-4">
                  <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-md">
                    <p className="text-sm font-medium mb-2">Candidate Added Successfully!</p>
                    <p className="text-xs text-muted-foreground mb-3">
                      <strong>Name:</strong> {generatedLink.name}<br/>
                      <strong>Email:</strong> {generatedLink.email}
                    </p>
                    <p className="text-xs text-muted-foreground mb-3">
                      Note: All candidates use the same shared test link. You can find it in the test management page.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={async () => {
                        try {
                          // Refresh tests before closing
                          const testsRes = await dsaApi.get('/tests/', {
                            params: { active_only: false }
                          })
                          setTests(testsRes.data)
                        } catch (error) {
                          console.error('Error refreshing tests:', error)
                          // Continue to close modal even if refresh fails
                        }
                        setInviteModal({ testId: '', open: false })
                        setGeneratedLink(null)
                        setCandidateName('')
                        setCandidateEmail('')
                      }}
                      className="flex-1"
                    >
                      Close
                    </Button>
                    <Button
                      onClick={() => {
                        setGeneratedLink(null)
                        setCandidateName('')
                        setCandidateEmail('')
                      }}
                      className="flex-1"
                    >
                      Add Another
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium mb-2 block">Candidate Name</label>
                    <input
                      type="text"
                      value={candidateName}
                      onChange={(e) => setCandidateName(e.target.value)}
                      placeholder="Enter candidate name"
                      className="w-full p-2 border rounded-md"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-2 block">Email Address</label>
                    <input
                      type="email"
                      value={candidateEmail}
                      onChange={(e) => setCandidateEmail(e.target.value)}
                      placeholder="candidate@example.com"
                      className="w-full p-2 border rounded-md"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      A unique test link will be generated for this candidate.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button 
                      onClick={() => handleAddCandidate(inviteModal.testId)} 
                      disabled={addingCandidate || !candidateName.trim() || !candidateEmail.trim()} 
                      className="flex-1"
                    >
                      {addingCandidate ? 'Adding...' : 'Add Candidate'}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setInviteModal({ testId: '', open: false })
                        setCandidateName('')
                        setCandidateEmail('')
                        setGeneratedLink(null)
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

