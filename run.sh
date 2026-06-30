#!/usr/bin/env bash
set -e

mvn package
java -jar target/training-tracker-1.0.0.jar
