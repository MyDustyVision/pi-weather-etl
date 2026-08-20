#!/bin/bash
# ============================================================
# Lambda Deployment Script
# Packages the Lambda function + psycopg2 and deploys to AWS
#
# Prerequisites:
#   - AWS CLI installed and configured (aws configure)
#   - Docker installed (used to compile psycopg2 for Amazon Linux)
#   - pip3 installed
#
# Usage:
#   chmod +x deploy_lambda.sh
#   ./deploy_lambda.sh
# ============================================================

set -e  # Exit on any error

FUNCTION_NAME="sensor-etl"
REGION="us-east-1"
RUNTIME="python3.11"
HANDLER="lambda_function.lambda_handler"
MEMORY=128       # MB — plenty for this workload
TIMEOUT=15       # seconds

echo "📦 Building Lambda deployment package..."

# Create clean build directory
BUILD_DIR="lambda_build"
rm -rf $BUILD_DIR && mkdir $BUILD_DIR

# Copy Lambda function
cp lambda_function.py $BUILD_DIR/

# Install psycopg2 compiled for Amazon Linux (Lambda runtime)
# IMPORTANT: Use psycopg2-binary, not psycopg2, for Lambda
pip3 install psycopg2-binary \
    --platform manylinux2014_x86_64 \
    --target $BUILD_DIR \
    --implementation cp \
    --python-version 3.11 \
    --only-binary=:all: \
    --upgrade

# Zip everything
cd $BUILD_DIR
zip -r ../lambda_package.zip . -q
cd ..

echo "✓ Package created: lambda_package.zip ($(du -sh lambda_package.zip | cut -f1))"

# ── Check if function exists ──────────────────────────────────
FUNCTION_EXISTS=$(aws lambda get-function --function-name $FUNCTION_NAME \
    --region $REGION 2>&1 || true)

if echo "$FUNCTION_EXISTS" | grep -q "ResourceNotFoundException"; then
    # ── Create the function ───────────────────────────────────
    echo "🚀 Creating Lambda function '$FUNCTION_NAME'..."

    # Create IAM role first (if it doesn't exist)
    ROLE_NAME="lambda-sensor-etl-role"
    TRUST_POLICY='{
        "Version": "2012-10-17",
        "Statement": [{
            "Effect": "Allow",
            "Principal": {"Service": "lambda.amazonaws.com"},
            "Action": "sts:AssumeRole"
        }]
    }'

    aws iam create-role \
        --role-name $ROLE_NAME \
        --assume-role-policy-document "$TRUST_POLICY" \
        --region $REGION 2>/dev/null || true

    aws iam attach-role-policy \
        --role-name $ROLE_NAME \
        --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole \
        --region $REGION 2>/dev/null || true

    ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${ROLE_NAME}"

    echo "  Waiting for IAM role to propagate..."
    sleep 10

    aws lambda create-function \
        --function-name $FUNCTION_NAME \
        --runtime $RUNTIME \
        --handler $HANDLER \
        --role $ROLE_ARN \
        --zip-file fileb://lambda_package.zip \
        --memory-size $MEMORY \
        --timeout $TIMEOUT \
        --region $REGION

    echo "✓ Lambda function created"
else
    # ── Update existing function ──────────────────────────────
    echo "🔄 Updating existing Lambda function '$FUNCTION_NAME'..."

    aws lambda update-function-code \
        --function-name $FUNCTION_NAME \
        --zip-file fileb://lambda_package.zip \
        --region $REGION

    echo "✓ Lambda function updated"
fi

# ── Set environment variable reminder ────────────────────────
echo ""
echo "⚠️  IMPORTANT: Set your DATABASE_URL environment variable!"
echo "   Run this command (replace with your Neon connection string):"
echo ""
echo "   aws lambda update-function-configuration \\"
echo "     --function-name $FUNCTION_NAME \\"
echo "     --environment 'Variables={DATABASE_URL=postgresql://user:pass@host.neon.tech/neondb?sslmode=require}' \\"
echo "     --region $REGION"
echo ""
echo "✅ Deployment complete!"

# Cleanup
rm -rf $BUILD_DIR lambda_package.zip
