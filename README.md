# 📌 NetSuite CSV Upload - 한글 인코딩 깨짐 이슈 정리

## 🧩 Issue Overview

CSV 업로드 → JSON staging → File Cabinet 저장 → 에러 CSV 다운로드 과정에서  
**한글이 깨지는 문제 발생**

---

## 🐛 Symptoms

- `log.debug`에서는 한글 정상 출력
- `JSON.stringify()` 결과도 정상
- 하지만 `file.create() → save()` 이후:
  - 한글이 `????`로 변환됨
  - 또는 다운로드 시 `\uXXXX` 형태로 출력됨

---

## 🔍 Root Cause

NetSuite File Module의 파일 저장 과정에서:

- UTF-8 인코딩이 보장되지 않음
- `file.save()` 시 non-ASCII 문자(한글)가 손상됨
- 특히 `file.Type.CSV` 사용 시 문제 발생 가능성 높음

---

## ⚠️ Problem Points

### 1. JSON 데이터를 CSV 타입으로 저장

```js
fileType: file.Type.CSV
