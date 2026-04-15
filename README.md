# 🚀 NetSuite CSV Upload & Processing

NetSuite SuiteScript 기반의  
**CSV 업로드 → 데이터 처리 → 에러 리포팅 자동화 시스템**

---

## 📌 Overview

이 프로젝트는 CSV 파일을 업로드하여  
NetSuite 트랜잭션 데이터를 자동으로 생성하고,  
처리 결과 및 에러를 관리하기 위한 구조입니다.

---

## ⚙️ Features

- 📂 CSV 파일 업로드 (Suitelet)
- 🔄 JSON Staging 처리
- ⚡ Map/Reduce 기반 대량 데이터 처리
- 📊 에러 행 추적 및 리포트 생성
- 📥 CSV 다운로드 (에러 리포트)
- 🔐 인코딩 이슈 대응 (Unicode Escape 처리)

---

## 🏗️ Architecture

```text
CSV Upload (Suitelet)
   ↓
Parse CSV → JSON Staging
   ↓
File Cabinet 저장
   ↓
Map/Reduce Processing
   ↓
Transaction 생성
   ↓
Error Collection
   ↓
Error CSV Download
