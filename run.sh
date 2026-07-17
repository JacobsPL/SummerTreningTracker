#!/usr/bin/env bash
set -e

mvn package
PORT=7070 java -jar target/training-tracker-1.0.0.jar
