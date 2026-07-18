# 고래지갑추적기

[고래지갑추적기](https://gorae-radar.vercel.app)는 Hyperliquid 공개 리더보드와 Info API를 이용해 상위 지갑의 열린 포지션을 관측하고, 시점별 원본 데이터와 비교 리포트를 제공하는 읽기 전용 서비스입니다.

주문·취소·청산 기능이나 거래소 API 키는 사용하지 않습니다. 화면의 라벨과 점수는 공개 데이터에 적용한 관찰 기준이며 지갑 소유자의 신원, 내부자 여부 또는 불법행위를 판정하지 않습니다.

## 주요 기능

- 상위 지갑의 현재 포지션과 롱·숏 노출 확인
- TradingView 차트와 종목별 고래 포지션 확인
- 관측 시각별 원본 JSON 보존
- 두 관측 시점에 공통으로 존재하는 지갑의 포지션 변화 비교
- 산식, 데이터 출처와 표본 한계를 함께 공개

## 자동 데이터 기록

GitHub Actions가 매일 **09:17 KST**에 공개 API 스냅샷을 생성합니다. JavaScript 테스트와 정적 사이트 검사를 모두 통과한 경우에만 `data/snapshots/`에 새 원본을 커밋합니다. 워크플로는 GitHub의 `Actions` 화면에서 수동으로도 실행할 수 있습니다.

## 로컬 검증

Node.js 22와 Python 3.12 환경을 기준으로 합니다.

```powershell
npm run capture:snapshot
npm run test:js
npm run audit:adsense
py -m pytest -q
py -m ruff check .
```

`npm run build`의 결과는 `dist/`에 생성됩니다. 환경 파일, 로컬 SQLite 데이터베이스, 관심 지갑 목록과 배포 설정은 Git에 포함하지 않습니다.

## 데이터 출처와 면책

- [Hyperliquid 공개 리더보드](https://stats-data.hyperliquid.xyz/Mainnet/leaderboard)
- [Hyperliquid Info API](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint)
- [사이트 방법론](https://gorae-radar.vercel.app/methodology)
- [투자 면책](https://gorae-radar.vercel.app/disclaimer)

이 프로젝트는 정보 제공용이며 투자 자문이나 수익 보장을 제공하지 않습니다.
