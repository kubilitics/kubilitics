#!/bin/bash
set -e

echo "🚀 Starting Phase 2 & 3: Setup and Execution"

# Phase 2: Setup
./tests/kcli_validation/setup_cluster.sh

# Phase 3: Test Suite
# Run the test suite from subdirectory
echo "🧪 Running Phase 3: kcli Validation Suite..."
cd tests/kcli_validation
go test -v .
cd ../..

echo "✅ Phase 3 Complete."
