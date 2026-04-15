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
```

- JSON 구조인데 CSV 타입 사용 → 인코딩 깨짐 유발

---

### 2. File Cabinet 저장 시 문자 손상

```js
file.create() → save()
```

- save 시점에서 한글이 `?`로 치환됨

---

### 3. Unicode escape 문자열 그대로 노출

```txt
\uc77c\ubc18\uc804\ud45c
```

- 저장 시 escape 처리했으나
- 다운로드 시 복원(decode) 안 해서 발생

---

## ✅ Solution

### 1. 저장 시 Unicode Escape 적용

```js
const safeContents = JSON.stringify(data).replace(
  /[^\x00-\x7F]/g,
  (ch) => "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0")
);
```

---

### 2. 파일 타입 변경 (CSV → PLAINTEXT)

```js
fileType: file.Type.PLAINTEXT
```

---

### 3. 다운로드 시 Unicode 복원

```js
const decodeUnicodeEscapes = (text) => {
  return text.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );
};
```

---

### 4. CSV 다운로드 강제 설정

```js
response.setHeader({
  name: "Content-Type",
  value: "text/csv; charset=UTF-8",
});

response.setHeader({
  name: "Content-Disposition",
  value: 'attachment; filename="error.csv"',
});

response.write(`\uFEFF${decodedContents}`);
```

---

## 🔄 Final Flow

```text
CSV Upload
 → UTF-8 읽기
 → JSON 변환
 → Unicode escape 적용
 → PLAINTEXT로 저장
 → Map/Reduce 처리
 → 에러 파일 생성
 → 다운로드 시 decode
 → CSV attachment로 응답
```

---

## 📌 Key Takeaway

> NetSuite File Cabinet은 한글 인코딩을 신뢰하면 안 된다.

---

## 💬 Short Summary

```text
파일 인코딩은 직접 제어해야 한다
```
