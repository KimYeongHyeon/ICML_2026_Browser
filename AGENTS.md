# Project context

## Conference PDF archive

학회 PDF의 최종 원본은 이 프로젝트 폴더가 아니라 NAS 아카이브를 기준으로 한다.

- 아카이브 운영 문서: [Conference PDF archive README](/Users/kyh/Workspace/conference-pdf-archive/README.md)
- 로컬 파이프라인 루트: [/Users/kyh/Workspace/conference-pdf-archive](/Users/kyh/Workspace/conference-pdf-archive)
- NAS 기준 루트: `/PROJECT_Yeonghyeon/conference-pdf-archive/`
- ICML PDF: `/PROJECT_Yeonghyeon/conference-pdf-archive/icml/<year>/pdfs/`
- MICCAI PDF: `/PROJECT_Yeonghyeon/conference-pdf-archive/miccai/<year>/pdfs/`
- 전체 학회 패턴: `/PROJECT_Yeonghyeon/conference-pdf-archive/<conference>/<year>/pdfs/`

논문 목록, 다운로드 상태, 실행 로그 및 미확보 보고서는 각각 아카이브 루트의
`queues/`, `state/`, `logs/`, `reports/`를 확인한다. NAS 업로드가 성공한 PDF는 로컬
`data/<conference>/<year>/pdfs/`에서 삭제될 수 있으므로 로컬 `data/`를 최종 원본으로
간주하지 않는다.

## UI verification

- UI/UX 최종 검증은 기본적으로 Codex 인앱 브라우저에서 수행한다.
- 데스크톱과 정확한 390px 모바일에서 콘솔·네트워크 오류, 핵심 상호작용, 가로 overflow를 확인한다.
- standalone/headed Playwright는 보조 회귀 증거이며 최종 interactive sign-off를 대신하지 않는다.
