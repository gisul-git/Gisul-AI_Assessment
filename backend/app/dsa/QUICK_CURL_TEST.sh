#!/bin/bash

# Quick test script for DSA API user isolation
# Usage: ./QUICK_CURL_TEST.sh <email> <password>

API_URL="http://localhost:8000"
EMAIL="${1:-your_email@example.com}"
PASSWORD="${2:-your_password}"

echo "=========================================="
echo "DSA API User Isolation Test"
echo "=========================================="
echo ""

# Step 1: Get authentication token
echo "Step 1: Getting authentication token..."
LOGIN_RESPONSE=$(curl -s -X POST "${API_URL}/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\": \"${EMAIL}\", \"password\": \"${PASSWORD}\"}")

TOKEN=$(echo $LOGIN_RESPONSE | grep -o '"token":"[^"]*' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  # Try alternative response format
  TOKEN=$(echo $LOGIN_RESPONSE | grep -o '"access_token":"[^"]*' | cut -d'"' -f4)
fi

if [ -z "$TOKEN" ]; then
  echo "❌ Failed to get token. Response:"
  echo "$LOGIN_RESPONSE" | jq '.' 2>/dev/null || echo "$LOGIN_RESPONSE"
  exit 1
fi

echo "✅ Token obtained: ${TOKEN:0:30}..."
echo ""

# Step 2: Debug user info
echo "Step 2: Checking user info and authentication..."
echo "----------------------------------------"
curl -s -X GET "${API_URL}/api/dsa/tests/debug/user-info" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" | jq '.'
echo ""

# Step 3: Get tests
echo "Step 3: Getting user's tests..."
echo "----------------------------------------"
TESTS_RESPONSE=$(curl -s -X GET "${API_URL}/api/dsa/tests/" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json")

echo "$TESTS_RESPONSE" | jq '.'
TEST_COUNT=$(echo "$TESTS_RESPONSE" | jq 'length' 2>/dev/null || echo "0")
echo ""
echo "Found $TEST_COUNT tests for this user"
echo ""

# Step 4: Get questions
echo "Step 4: Getting user's questions..."
echo "----------------------------------------"
QUESTIONS_RESPONSE=$(curl -s -X GET "${API_URL}/api/dsa/questions/" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json")

echo "$QUESTIONS_RESPONSE" | jq '.'
QUESTION_COUNT=$(echo "$QUESTIONS_RESPONSE" | jq 'length' 2>/dev/null || echo "0")
echo ""
echo "Found $QUESTION_COUNT questions for this user"
echo ""

echo "=========================================="
echo "Test Complete!"
echo "=========================================="
echo ""
echo "To test user isolation:"
echo "1. Run this script with User A's credentials"
echo "2. Run this script with User B's credentials"
echo "3. Verify that each user only sees their own tests/questions"
echo ""
echo "Example:"
echo "  ./QUICK_CURL_TEST.sh user_a@example.com password_a"
echo "  ./QUICK_CURL_TEST.sh user_b@example.com password_b"


