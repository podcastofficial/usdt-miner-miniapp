# Part 23 — Explainable Risk Scoring

Adds a deterministic, rule-based risk score from existing open fraud flags. Each score includes its contributing signals and a low/medium/high band. It is explicitly not an AI model, does not auto-block users, and does not initiate any money action. Admin recalculation is bounded and audited.

API: `adminRiskOverview`, `adminRiskRecalculate`.
Migration: `021_part23_risk_scores.sql`.
