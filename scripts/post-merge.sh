#!/bin/bash
set -e
npm install
bash scripts/db-sync.sh
