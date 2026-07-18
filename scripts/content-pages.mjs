import { editorialPages } from "./editorial-pages.mjs";
import { loadComparisonReportPages } from "./comparison-pages.mjs";
import { loadSnapshotReportPages } from "./snapshot-pages.mjs";

const updatedAt = "2026-07-18";
const defaultPublishedAt = "2026-07-10";
const snapshotReportPages = await loadSnapshotReportPages();
const comparisonReportPages = await loadComparisonReportPages();
export const latestSnapshotReport = snapshotReportPages[0] || null;
export const featuredReport = comparisonReportPages[0] || latestSnapshotReport;
const reportPages = [
  ...snapshotReportPages,
  ...comparisonReportPages,
  ...editorialPages.filter((page) => page.slug.startsWith("reports/")),
].sort((a, b) => String(b.slug).localeCompare(String(a.slug)));

function reportIndexCards() {
  return reportPages.map((page) => `
        <article class="report-index-card">
          <div><time datetime="${page.observedDate || page.publishedAt || page.updatedAt || defaultPublishedAt}">${page.observedDate || page.publishedAt || page.updatedAt || defaultPublishedAt} 관측</time><span>${page.comparisonReport ? "원본 2개 비교" : page.snapshotFile ? "원본 JSON 포함" : "편집 리포트"}</span></div>
          <h2><a href="/${page.slug}">${page.title}</a></h2>
          <p>${page.description}</p>
          <a class="report-index-link" href="/${page.slug}">리포트 읽기</a>
        </article>
      `).join("");
}

export const contentPages = [
  {
    slug: "reports",
    title: "관측 데이터 리포트",
    description: "Hyperliquid 공개 지갑의 포지션을 시점별로 보존하고 롱·숏 노출, 집중도와 표본 한계를 원본 데이터와 함께 설명합니다.",
    publishedAt: "2026-07-18",
    updatedAt: "2026-07-18",
    body: `
      <header class="content-hero">
        <span class="content-kicker">DATA REPORTS</span>
        <h1>화면에서 사라지는 움직임을<br>기록으로 남깁니다</h1>
        <p class="content-lede">라이브 화면은 현재 상태를 보여주고, 리포트는 관측 시각의 공개 포지션을 별도 파일로 보존해 당시의 롱·숏 노출과 집중도를 다시 검토할 수 있게 합니다.</p>
      </header>
      <section>
        <h2>리포트에서 확인할 수 있는 것</h2>
        <div class="definition-grid">
          <div><strong>관측 조건</strong><span>조회 시각, 후보 범위, 결과 지갑 수와 최소 점수를 표시합니다.</span></div>
          <div><strong>방향 노출</strong><span>관측 지갑의 롱·숏 명목가치와 순노출을 같은 기준으로 합산합니다.</span></div>
          <div><strong>집중도</strong><span>상위 포지션과 상위 지갑이 전체 표본에서 차지하는 비중을 계산합니다.</span></div>
          <div><strong>검증 자료</strong><span>자동 스냅샷은 계산 전 원본 JSON을 함께 공개합니다.</span></div>
        </div>
      </section>
      <section class="report-index" aria-labelledby="report-index-title">
        <h2 id="report-index-title">발행된 리포트</h2>
        <div class="report-index-list">${reportIndexCards()}</div>
      </section>
      <section>
        <h2>읽을 때 주의할 점</h2>
        <p>각 리포트는 기록된 한 시점과 제한된 후보 지갑 표본을 설명합니다. 시장 전체 포지션, 지갑 소유자의 신원이나 거래 의도, 이후 가격 방향을 뜻하지 않습니다. 현재 상태와 차이가 날 수 있으므로 <a href="/live">라이브 화면</a>과 <a href="/methodology">집계 방법론</a>을 함께 확인해 주세요.</p>
      </section>
    `,
  },
  {
    slug: "about",
    title: "서비스 소개",
    description: "고래지갑추적기가 제공하는 정보, 데이터 출처, 운영 원칙과 서비스 범위를 설명합니다.",
    body: `
      <header class="content-hero">
        <span class="content-kicker">서비스 안내</span>
        <h1>내부자 의심 후보의 포지션을 한 화면에서</h1>
        <p class="content-lede">고래지갑추적기는 Hyperliquid 공개 데이터에서 특이한 수익과 포지션 조합이 포착된 지갑을 관찰 후보로 분류하고 현재 노출을 비교해 보여줍니다.</p>
      </header>
      <section>
        <h2>왜 만들었나요?</h2>
        <p>공개 거래 데이터는 누구나 볼 수 있지만, 지갑마다 포지션과 손익을 따로 확인해야 하므로 관측 지갑의 전체 노출을 파악하기 어렵습니다. 고래지갑추적기는 여러 공개 지갑을 같은 기준으로 정리해 현재 어떤 자산과 방향에 노출되어 있는지 비교할 수 있도록 돕습니다.</p>
        <p>이 서비스의 목적은 공개 데이터에서 추가 확인이 필요한 지갑을 빠르게 찾는 것입니다. 내부자 의심 후보라는 표현은 관찰 라벨이며 특정 거래를 추천하거나 실제 내부자 지위를 판정하지 않습니다.</p>
      </section>
      <section>
        <h2>제공하는 정보</h2>
        <ul>
          <li>리더보드에서 선별한 관측 지갑과 현재 열린 포지션</li>
          <li>코인별 롱·숏 포지션 가치와 참여 지갑 수</li>
          <li>지갑 규모, 기간별 손익, 활동량을 조합한 관찰 점수</li>
          <li>대형 수익, 집중 노출, 방향 편중과 레버리지 조합을 설명하는 내부자 의심 후보 라벨</li>
          <li>브라우저에만 저장되는 관심 지갑 목록</li>
        </ul>
      </section>
      <section>
        <h2>제공하지 않는 것</h2>
        <p>주문 실행, 자산 보관, 개인 지갑 연결, 수익 보장, 개인별 투자 자문은 제공하지 않습니다. 지갑 소유자의 신원, 미공개 정보 보유 여부, 내부자 지위나 불법행위도 확인하거나 판정하지 않습니다. 공개 지갑의 포지션은 언제든 바뀔 수 있고 데이터 갱신에는 지연이 생길 수 있습니다.</p>
      </section>
      <section class="content-callout">
        <h2>독립적으로 운영합니다</h2>
        <p>고래지갑추적기는 Hyperliquid와 제휴하거나 공식 인증을 받은 서비스가 아닙니다. 데이터 구조와 용어는 <a href="https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint" rel="noopener noreferrer">Hyperliquid 공개 API 문서</a>를 참고합니다.</p>
      </section>
      <section>
        <h2>운영자와 검토 원칙</h2>
        <p>이 사이트는 <a href="https://github.com/hodookim" rel="noopener noreferrer">hodookim</a>이 운영하는 독립 프로젝트입니다. 운영자는 공개 데이터와 실제 운영 코드를 기준으로 설명과 계산을 검토하며, 지갑 소유자의 신원, 비공개 거래 의도, 미공개 정보 이용 여부를 추정하거나 단정하지 않습니다.</p>
        <p>코드와 문장 초안에 AI 보조 도구를 사용할 수 있지만 수치, 산식, 외부 링크는 게시 전에 실제 응답과 공식 문서에 대조하는 것을 원칙으로 합니다. 오류가 확인되면 해당 페이지의 수정일과 내용을 갱신합니다.</p>
      </section>
      <section>
        <h2>광고와 편집의 분리</h2>
        <p>광고 사업자는 후보 지갑 선정, 점수, 순위, 데이터 해석에 관여하지 않습니다. 광고 수익과 무관하게 같은 산식을 적용하며 광고를 데이터 결과나 추천처럼 표시하지 않습니다. 자세한 기준은 <a href="/editorial-policy">편집·검토 및 정정 정책</a>에서 확인할 수 있습니다.</p>
      </section>
    `,
  },
  {
    slug: "author/hodookim",
    title: "운영자 hodookim",
    description: "고래지갑추적기 운영자 hodookim의 역할, 데이터 검토 범위, 작성 원칙과 공개 연락 채널을 안내합니다.",
    publishedAt: "2026-07-18",
    updatedAt: "2026-07-18",
    body: `
      <header class="content-hero">
        <span class="content-kicker">운영자</span>
        <h1>hodookim</h1>
        <p class="content-lede">고래지갑추적기의 코드, 공개 데이터 집계, 설명 문서와 정정 기록을 관리하는 개인 운영자입니다.</p>
      </header>
      <section>
        <h2>담당하는 일</h2>
        <p>Hyperliquid 공개 API 응답을 조회하는 코드와 지갑·포지션 집계 로직을 관리합니다. 화면에 표시되는 수치와 설명이 실제 구현과 일치하는지 확인하고, 데이터 오류나 해석상 문제가 발견되면 관련 페이지와 수정일을 갱신합니다.</p>
        <p>운영자는 투자자문 자격이나 특정 수익률을 주장하지 않습니다. 서비스의 점수와 라벨은 공개 표본을 비교하기 위한 관찰 기준이며 지갑 소유자의 신원이나 거래 의도를 판정하지 않습니다.</p>
      </section>
      <section>
        <h2>검토 범위</h2>
        <ul>
          <li>운영 코드와 Hyperliquid 공개 응답의 필드 대조</li>
          <li>점수, 노출, 방향 비중과 포지션 가치 계산 확인</li>
          <li>리포트의 관측 시각, 표본 조건과 한계 표시</li>
          <li>확인할 수 없는 소유자 신원과 비공개 의도에 대한 단정 배제</li>
          <li>오류 제보 확인과 편집·정정 기록 갱신</li>
        </ul>
      </section>
      <section>
        <h2>AI 보조 도구 사용</h2>
        <p>코드 작성, 문장 초안과 오류 탐색에 AI 보조 도구를 사용할 수 있습니다. 게시 전 수치, 산식과 출처는 실제 운영 코드, 공개 API 응답과 공식 문서를 기준으로 다시 확인합니다. 자동 생성된 가격 전망이나 검증하지 않은 수익 주장은 게시하지 않습니다.</p>
      </section>
      <section class="content-callout">
        <h2>공개 채널</h2>
        <p><a href="https://github.com/hodookim" rel="me noopener noreferrer">GitHub @hodookim</a>에서 운영자 공개 프로필을 확인할 수 있습니다. 오류와 정정 요청은 <a href="/contact">문의 안내</a>에 적힌 재현 정보를 함께 보내 주세요.</p>
      </section>
    `,
  },
  {
    slug: "methodology",
    title: "탐지 방법론",
    description: "고래지갑추적기의 데이터 수집 범위, 후보 점수, 내부자 의심 후보 라벨, 포지션 집계 방식과 한계를 공개합니다.",
    article: true,
    schemaType: "TechArticle",
    body: `
      <header class="content-hero">
        <span class="content-kicker">산정 방식</span>
        <h1>지갑 선정과 점수 산정 방식</h1>
        <p class="content-lede">데이터 출처, 지갑 선정 조건, 내부자 의심 후보 라벨과 갱신 방식을 안내합니다.</p>
      </header>
      <section>
        <h2>1. 데이터 출처</h2>
        <p>후보 목록은 Hyperliquid가 공개하는 leaderboard 데이터에서 가져옵니다. 후보 지갑의 현재 포지션은 공개 Info API의 clearinghouse 상태를 조회해 구성합니다. 개인 키, 거래소 API 키, 로그인 정보는 사용하지 않습니다.</p>
        <p>Info API는 특정 사용자의 포지션 상태를 반환하는 공개 조회 인터페이스입니다. 자세한 응답 구조는 <a href="https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint" rel="noopener noreferrer">공식 Info endpoint 문서</a>에서 확인할 수 있습니다.</p>
      </section>
      <section>
        <h2>2. 후보 선정</h2>
        <p>leaderboard 상위 행 중 유효한 0x 주소를 가진 지갑을 대상으로 계정 가치, 일간·주간·월간 손익, 전체 기간 손익, 월간 거래량을 확인합니다. 서버 부하와 공개 API 제한을 고려해 한 번에 확인하는 후보 수에는 상한이 있습니다.</p>
        <p>따라서 화면은 시장 전체 지갑을 전수 조사한 결과가 아닙니다. 현재 조회한 후보 집합 안에서 포지션을 보유한 지갑을 보여주는 표본입니다.</p>
      </section>
      <section>
        <h2>3. 관찰 점수</h2>
        <div class="definition-grid">
          <div><strong>규모</strong><span>계정 가치가 일정 구간을 넘을 때 가중합니다.</span></div>
          <div><strong>성과</strong><span>일간, 주간, 월간, 전체 기간의 양수 손익을 구간별로 반영합니다.</span></div>
          <div><strong>활동성</strong><span>월간 거래량이 충분한지 확인합니다.</span></div>
          <div><strong>위험 조정</strong><span>월간과 주간 손익이 동시에 음수이면 감점합니다.</span></div>
        </div>
        <p>규모는 계정 가치가 1만·10만·100만 달러를 넘을 때 각각 8점을 더합니다. 양수 손익은 일간 손익÷10,000(최대 8점), 주간 손익÷50,000(최대 14점), 월간 손익÷100,000(최대 18점)으로 반영합니다. 전체 기간 손익이 양수면 8점, 월간 거래량이 1,000만 달러 이상이면 8점을 더하며 주간과 월간 손익이 모두 음수면 18점을 뺍니다.</p>
        <p>최종 점수는 0에서 100 사이로 제한됩니다. 높은 점수는 미래 수익률이나 내부 정보 보유를 뜻하지 않습니다. 공개 지표상 먼저 살펴볼 후보라는 의미만 가집니다. 전체 산식과 계산 예제는 <a href="/guides/scoring">관찰 점수 계산 완전 해설</a>에 공개합니다.</p>
      </section>
      <section>
        <h2>4. 내부자 의심 후보 라벨</h2>
        <p><strong>내부자 의심 후보</strong>는 공개 데이터에서 추가로 살펴볼 만한 특이 조합이 나타난 지갑에 붙이는 관찰 라벨입니다. 실제 회사 관계자, 프로젝트 관계자 또는 법률상 내부자임을 뜻하지 않습니다.</p>
        <div class="definition-grid">
          <div><strong>큰 수익</strong><span>최근 기간에 큰 양수 손익이 관찰됐는지 확인합니다.</span></div>
          <div><strong>집중 노출</strong><span>전체 노출이 소수 종목이나 한 포지션에 몰렸는지 확인합니다.</span></div>
          <div><strong>방향 편중</strong><span>현재 롱 또는 숏 노출이 한쪽으로 크게 치우쳤는지 확인합니다.</span></div>
          <div><strong>레버리지</strong><span>높은 레버리지가 다른 특이 지표와 함께 나타나는지 확인합니다.</span></div>
        </div>
        <p>하나의 조건만으로 라벨을 붙이지 않고 여러 공개 지표의 조합과 강도를 봅니다. 라벨과 선정 근거는 조회 시점의 공개 수치에 따라 달라질 수 있습니다. 서비스는 지갑 소유자의 신원, 미공개 정보 보유 또는 이용 여부, 내부자 지위, 불법행위를 확인하지 않으며 해당 라벨을 그 증거로 사용해서는 안 됩니다.</p>
      </section>
      <section>
        <h2>5. 롱·숏 노출 집계</h2>
        <p>포지션의 signed size가 양수이면 롱, 음수이면 숏으로 분류합니다. 포지션 가치는 절댓값으로 합산합니다. 코인과 방향이 같은 포지션을 하나의 그룹으로 묶고 참여 지갑 수, 총 포지션 가치, 가중 평균 ROE를 계산합니다.</p>
        <p>방향 비중은 같은 코인에서 롱과 숏 노출이 차지하는 비중을 비교한 값입니다. 소수의 대형 포지션이 결과를 크게 움직일 수 있으므로 참여 지갑 수와 함께 봐야 합니다.</p>
        <p>집중 점수는 기본 12점에 참여 지갑 평균 후보 점수, 포지션 가치, 참여 지갑 수, 반대 방향 대비 우세도를 각각 28·34·14·8의 가중치로 반영하고 99점에서 제한합니다. 규모 요소는 포지션 가치÷(포지션 가치+150만 달러), 지갑 요소는 최대 4개까지 반영합니다.</p>
      </section>
      <section>
        <h2>6. 갱신과 지연</h2>
        <p>화면은 약 10초 간격으로 재조회하지만 같은 조건의 서버 응답은 약 30초 동안 캐시될 수 있습니다. 기본 요청은 최대 24개 후보를 순차 확인하고, 열린 포지션이 있는 지갑을 최대 12개까지 표시합니다. 모든 값이 동일한 시점의 스냅샷은 아닙니다.</p>
        <p>네트워크 상태와 외부 API 제한에 따라 더 오래 걸리거나 일부 데이터가 비어 있을 수 있습니다. 한 후보의 조회가 실패하면 전체 결과를 비우지 않고 다음 후보를 계속 확인합니다. 자세한 누락 조건은 <a href="/guides/data-quality">데이터 품질과 지연 점검</a>에서 설명합니다.</p>
      </section>
      <section class="content-callout">
        <h2>해석 원칙</h2>
        <p>단일 점수, 내부자 의심 후보 라벨이나 한 지갑의 포지션만으로 결론을 내리지 마세요. 서로 다른 기간, 여러 지갑의 방향, 포지션 규모, 레버리지와 시장 가격을 함께 확인해야 합니다.</p>
      </section>
    `,
  },
  {
    slug: "guides/whale-wallets",
    title: "고래 지갑 관찰 가이드",
    description: "고래 지갑을 따라가기 전에 알아야 할 표본 편향, 포지션 변화, 위험 관리와 검증 방법을 설명합니다.",
    article: true,
    body: `
      <header class="content-hero">
        <span class="content-kicker">지갑 추적</span>
        <h1>고래 지갑 데이터 해석하기</h1>
        <p class="content-lede">포지션 규모뿐 아니라 진입 시점, 레버리지, 여러 지갑의 방향을 함께 확인해야 합니다.</p>
      </header>
      <section>
        <h2>고래 지갑을 보는 이유</h2>
        <p>대규모 포지션을 가진 지갑은 시장 방향에 대한 강한 견해를 드러낼 수 있습니다. 여러 지갑이 같은 코인과 같은 방향에 동시에 노출되면 관측 대상 지갑의 관심이 어디에 모이는지 파악하는 단서가 됩니다.</p>
        <p>하지만 화면에 보이는 포지션은 전체 전략의 일부일 수 있습니다. 다른 거래소나 현물 지갑에서 반대 포지션을 보유해 헤지하고 있을 수도 있고, 이미 이익을 실현한 뒤 남은 잔여 포지션일 수도 있습니다.</p>
      </section>
      <section>
        <h2>비교할 항목</h2>
        <ol>
          <li><strong>표본의 범위:</strong> 어떤 기준으로 지갑이 선정됐는지 확인합니다. leaderboard 상위권은 과거 성과가 좋은 집단이지만 시장 전체를 대표하지 않습니다.</li>
          <li><strong>포지션의 크기:</strong> 금액만 보지 말고 계정 가치 대비 비중을 봅니다. 같은 100만 달러 포지션도 계정 규모에 따라 의미가 달라집니다.</li>
          <li><strong>진입 시점:</strong> 현재 가격이 진입가에서 크게 멀어졌다면 새로 따라가는 거래의 손익 구조는 원래 지갑과 다릅니다.</li>
          <li><strong>레버리지와 청산 위험:</strong> 레버리지가 높으면 작은 가격 변화에도 포지션이 빠르게 줄거나 청산될 수 있습니다.</li>
        </ol>
      </section>
      <section>
        <h2>개별 지갑과 집단 비교</h2>
        <p>한 지갑은 실수할 수 있고, 전략의 목적도 알 수 없습니다. 여러 지갑이 같은 방향을 보이는지, 그 흐름이 여러 갱신 주기 동안 유지되는지, 반대 방향의 노출은 얼마나 큰지를 함께 확인하는 편이 낫습니다.</p>
        <p>고래지갑추적기의 방향 비중과 참여 지갑 수는 이런 비교를 돕기 위한 보조 지표입니다. 방향 비중이 높아도 참여 지갑이 한두 개라면 단정하지 않고 관찰 대상으로 해석하는 것이 안전합니다.</p>
      </section>
      <section>
        <h2>성과 추종의 함정</h2>
        <p>leaderboard는 이미 성과가 드러난 지갑을 보여주므로 생존자 편향이 있습니다. 과거 수익이 미래에도 반복된다는 보장은 없습니다. 변동성이 큰 시기에는 높은 레버리지로 얻은 수익이 점수를 끌어올릴 수 있고, 같은 전략이 반대 방향으로 움직일 때 손실도 커질 수 있습니다.</p>
        <p>또한 공개 포지션을 조회한 시점과 사용자가 화면을 보는 시점 사이에는 지연이 있습니다. 원래 지갑이 포지션을 줄였거나 닫았을 가능성을 항상 고려해야 합니다.</p>
      </section>
      <section>
        <h2>확인 항목</h2>
        <ul>
          <li>최소 두 번 이상의 갱신에서 포지션이 유지되는가?</li>
          <li>같은 방향에 참여한 지갑 수가 충분한가?</li>
          <li>진입가와 현재가의 차이가 과도하지 않은가?</li>
          <li>레버리지와 청산가가 허용 가능한 범위인가?</li>
          <li>반대 방향 대형 포지션이 동시에 존재하지 않는가?</li>
          <li>내가 감당할 수 있는 손실 한도를 먼저 정했는가?</li>
        </ul>
      </section>
      <section class="content-callout">
        <h2>요약</h2>
        <p>고래 지갑 데이터는 조사 시작점으로 사용하세요. 다른 시장 정보와 독립적으로 검증하고, 타인의 포지션을 그대로 복제하지 않는 것이 기본 원칙입니다.</p>
      </section>
    `,
  },
  {
    slug: "guides/positions",
    title: "포지션 지표 읽는 법",
    description: "롱과 숏, 포지션 가치, ROE, 미실현 손익, 레버리지와 청산가를 함께 해석하는 방법을 안내합니다.",
    article: true,
    body: `
      <header class="content-hero">
        <span class="content-kicker">포지션 용어</span>
        <h1>포지션 지표 이해하기</h1>
        <p class="content-lede">롱·숏, 포지션 가치, ROE, 레버리지와 청산가의 의미를 정리했습니다.</p>
      </header>
      <section>
        <h2>롱과 숏</h2>
        <p>롱은 가격 상승에 유리한 방향이고 숏은 가격 하락에 유리한 방향입니다. 고래지갑추적기는 signed size가 양수이면 롱, 음수이면 숏으로 분류합니다. 방향은 시장 전망을 보여주지만 손익 가능성을 보장하지 않습니다.</p>
      </section>
      <section>
        <h2>포지션 가치</h2>
        <p>포지션 가치는 현재 포지션의 명목 금액입니다. 지갑의 실제 증거금보다 클 수 있으며 레버리지를 포함한 노출을 나타냅니다. 큰 숫자만 보고 영향력이 크다고 판단하지 말고 계정 가치와 레버리지를 함께 비교해야 합니다.</p>
      </section>
      <section>
        <h2>진입가와 현재가</h2>
        <p>진입가는 포지션의 평균 기준 가격이고 현재가는 조회 시점의 가격입니다. 롱 포지션은 현재가가 진입가보다 높을 때, 숏 포지션은 현재가가 진입가보다 낮을 때 일반적으로 유리합니다.</p>
        <p>현재 가격이 진입가에서 많이 벗어났다면 화면에 보이는 수익률을 새 거래가 그대로 얻을 수 없습니다. 같은 방향으로 진입하더라도 손절 범위와 기대 수익이 완전히 달라집니다.</p>
      </section>
      <section>
        <h2>미실현 PnL과 ROE</h2>
        <p>미실현 PnL은 아직 포지션을 닫지 않은 상태의 평가 손익입니다. 가격이 바뀌면 계속 변하며 실제 확정 수익이 아닙니다. ROE는 사용된 증거금 대비 손익 비율이므로 레버리지가 높을수록 절댓값이 크게 나타날 수 있습니다.</p>
        <p>높은 ROE가 곧 안정적인 거래를 뜻하지 않습니다. 적은 증거금과 높은 레버리지 조합에서도 매우 높은 양수 또는 음수 ROE가 나올 수 있습니다.</p>
      </section>
      <section>
        <h2>레버리지와 청산가</h2>
        <p>레버리지는 증거금보다 큰 포지션을 운용하는 배율입니다. 배율이 높을수록 작은 가격 변동이 손익과 청산 위험에 크게 반영됩니다. 청산가는 증거금 조건이 유지되지 못해 포지션이 강제로 정리될 수 있는 기준 가격입니다.</p>
        <p>청산가가 표시되지 않거나 비어 있어도 위험이 없다는 뜻은 아닙니다. 교차 마진, 다른 포지션, 계정 잔고 변화에 따라 실제 위험 수준이 달라질 수 있습니다.</p>
      </section>
      <section>
        <h2>집계 지표 읽기</h2>
        <div class="definition-grid">
          <div><strong>롱 노출</strong><span>조회한 지갑의 롱 포지션 가치를 합산한 값입니다.</span></div>
          <div><strong>숏 노출</strong><span>조회한 지갑의 숏 포지션 가치를 합산한 값입니다.</span></div>
          <div><strong>참여 지갑 수</strong><span>같은 코인과 방향에 포지션을 가진 서로 다른 지갑 수입니다.</span></div>
          <div><strong>방향 비중</strong><span>같은 코인의 전체 노출 중 특정 방향이 차지하는 비중입니다.</span></div>
        </div>
      </section>
      <section class="content-callout">
        <h2>지표 확인 순서</h2>
        <p>방향을 확인하고, 참여 지갑 수와 포지션 가치를 비교한 뒤, 각 지갑의 진입가와 레버리지, 청산가를 확인하세요. 마지막으로 데이터 갱신 시각과 반대 방향 노출을 확인합니다.</p>
      </section>
    `,
  },
  {
    slug: "privacy",
    title: "개인정보처리방침",
    description: "고래지갑추적기가 처리하는 정보, 브라우저 저장소, 광고 쿠키와 이용자 선택권을 안내합니다.",
    body: `
      <header class="content-hero">
        <span class="content-kicker">개인정보</span>
        <h1>개인정보처리방침</h1>
        <p class="content-lede">고래지갑추적기는 서비스 제공에 필요한 정보만 처리하고, 관심 지갑 목록은 기본적으로 이용자의 브라우저에 저장합니다.</p>
      </header>
      <section>
        <h2>1. 처리하는 정보</h2>
        <p>서비스는 계정 가입을 요구하지 않으며 이름, 전화번호, 개인 지갑의 개인 키를 수집하지 않습니다. 이용자가 관심 지갑 기능에 직접 입력한 공개 지갑 주소와 라벨은 해당 브라우저의 localStorage에 저장됩니다.</p>
        <p>호스팅과 보안 운영 과정에서 접속 시각, 요청 URL, 브라우저 종류, IP 주소와 같은 기본 로그가 호스팅 사업자에 의해 일시적으로 처리될 수 있습니다.</p>
      </section>
      <section>
        <h2>2. 공개 블록체인 및 거래 데이터</h2>
        <p>화면에 표시되는 지갑 주소와 포지션은 공개적으로 조회 가능한 데이터입니다. 서비스는 이를 관찰 목적으로 재구성합니다. 내부자 의심 후보 라벨을 포함해 공개 주소가 특정 개인과 연결될 수 있는 경우에도 서비스는 소유자의 신원, 미공개 정보 보유 또는 이용 여부, 내부자 지위나 불법행위를 확인하거나 단정하지 않습니다.</p>
      </section>
      <section>
        <h2>3. Google 광고와 쿠키</h2>
        <p>Google을 포함한 제3자 광고 사업자는 광고 제공과 측정을 위해 이용자의 브라우저에 쿠키를 배치하거나 기존 쿠키를 읽을 수 있으며, 웹 비콘·IP 주소·기기 및 브라우저 식별자와 같은 기술을 사용할 수 있습니다. Google의 광고 쿠키를 통해 Google과 파트너는 이 사이트 또는 다른 사이트 방문 기록을 기반으로 광고를 제공할 수 있습니다.</p>
        <p>Google이 파트너 사이트에서 정보를 처리하는 방법은 <a href="https://policies.google.com/technologies/partner-sites" rel="noopener noreferrer">Google 파트너 사이트 데이터 이용 안내</a>에서 확인할 수 있습니다. 이용자는 <a href="https://adssettings.google.com/" rel="noopener noreferrer">Google 광고 설정</a>에서 맞춤 광고를 관리하거나 사용 중지할 수 있습니다.</p>
        <p>EEA, 영국, 스위스 등 동의가 필요한 지역에서는 Google 인증 동의 관리 플랫폼을 통해 동의, 거부, 옵션 관리 선택지를 제공하도록 설정합니다. 동의 선택은 브라우저와 광고 사업자의 정책에 따라 저장될 수 있습니다.</p>
      </section>
      <section>
        <h2>4. 외부 서비스</h2>
        <ul>
          <li>Vercel: 웹 호스팅, 전송, 보안 로그</li>
          <li>Google AdSense: 사이트 소유권 확인, 광고 제공, 측정</li>
          <li>Hyperliquid 공개 API: 지갑 포지션과 시장 데이터 조회</li>
          <li>jsDelivr 및 CoinGecko: 코인 아이콘 정적 파일 제공</li>
          <li>TradingView: 차트 위젯 제공</li>
          <li>Alternative.me: 공포와 탐욕 지수 데이터 제공</li>
        </ul>
        <p>TradingView 차트가 로드되면 TradingView는 위젯 제공을 위해 현재 페이지 URL, 위젯 유형, 화면에 표시할 종목 심볼과 IP 주소를 처리합니다. <a href="https://www.tradingview.com/widget-docs/faq/general/" rel="noopener noreferrer">현재 공식 위젯 안내</a>에 따르면 위젯 자체는 쿠키를 설정하지 않습니다. TradingView의 전체 정보 처리 기준은 <a href="https://www.tradingview.com/privacy-policy/" rel="noopener noreferrer">TradingView 개인정보처리방침</a>에서 확인할 수 있습니다.</p>
        <p>시장 심리 지표는 <a href="https://alternative.me/crypto/fear-and-greed-index/" rel="noopener noreferrer">Alternative.me Crypto Fear &amp; Greed Index</a> 공개 API에서 가져오며 지수 값, 분류, 갱신 시각과 출처를 함께 표시합니다. 데이터 제공 조건과 사업자의 정보 처리 방식은 <a href="https://alternative.me/privacy-policy/" rel="noopener noreferrer">Alternative.me 개인정보처리방침</a>에서 확인할 수 있습니다.</p>
        <p>향후 다른 외부 서비스나 광고 사업자를 사용하는 경우 이 방침에 사업자, 처리 목적, 정책 링크와 이용자 선택 방법을 추가한 뒤 적용합니다.</p>
      </section>
      <section>
        <h2>5. 이용자의 선택</h2>
        <p>관심 지갑 정보는 관심지갑 화면에서 삭제할 수 있으며 브라우저 저장소를 지우면 모두 제거됩니다. 브라우저 설정에서 쿠키와 localStorage를 제한할 수 있지만 일부 기능이 정상 동작하지 않을 수 있습니다.</p>
      </section>
      <section>
        <h2>6. 문의와 변경</h2>
        <p>개인정보 관련 문의는 <a href="/contact">문의 페이지</a>의 운영 채널을 이용해 주세요. 요청에는 공개할 필요가 없는 개인 정보나 지갑 개인 키를 포함하지 마세요. 정책이 변경되면 이 페이지의 수정일을 갱신하고 중요한 변경은 서비스 화면에 알립니다.</p>
      </section>
    `,
  },
  {
    slug: "terms",
    title: "이용약관",
    description: "고래지갑추적기 서비스의 이용 조건, 책임 범위, 금지 행위와 변경 원칙을 안내합니다.",
    body: `
      <header class="content-hero">
        <span class="content-kicker">이용 조건</span>
        <h1>이용약관</h1>
        <p class="content-lede">서비스를 이용하면 아래 조건에 동의한 것으로 봅니다.</p>
      </header>
      <section>
        <h2>1. 서비스 목적</h2>
        <p>고래지갑추적기는 공개된 시장과 지갑 데이터를 정리해 이용자의 독립적인 조사와 학습을 돕는 정보 서비스입니다. 거래소, 중개업자, 투자자문업자 또는 자산 보관 서비스가 아닙니다.</p>
      </section>
      <section>
        <h2>2. 데이터와 가용성</h2>
        <p>외부 API, 네트워크, 캐시와 계산 과정으로 인해 정보가 지연되거나 부정확하거나 일시적으로 제공되지 않을 수 있습니다. 서비스는 특정 시점의 데이터 정확성, 완전성, 지속적인 제공을 보장하지 않습니다.</p>
      </section>
      <section>
        <h2>3. 이용자의 책임</h2>
        <p>이용자는 표시된 정보를 독립적으로 검증하고 자신의 판단과 책임으로 사용해야 합니다. 거래나 투자 결정을 내리기 전에 필요한 경우 자격을 갖춘 전문가의 조언을 구해야 합니다.</p>
      </section>
      <section>
        <h2>4. 금지 행위</h2>
        <ul>
          <li>서비스 또는 외부 API에 과도한 자동 요청을 보내는 행위</li>
          <li>보안 취약점을 악용하거나 서비스 운영을 방해하는 행위</li>
          <li>화면의 정보를 조작해 수익 보장이나 공식 제휴가 있는 것처럼 표시하는 행위</li>
          <li>타인의 권리 또는 관련 법령을 침해하는 행위</li>
        </ul>
      </section>
      <section>
        <h2>5. 책임 제한</h2>
        <p>법이 허용하는 범위에서 서비스 운영자는 정보 이용, 거래 손실, 데이터 지연, 서비스 중단으로 발생한 간접 또는 결과적 손해에 책임을 지지 않습니다.</p>
      </section>
      <section>
        <h2>6. 변경</h2>
        <p>기능과 정책 변화에 따라 약관을 수정할 수 있습니다. 중요한 변경은 적용 전에 사이트에서 안내합니다.</p>
      </section>
    `,
  },
  {
    slug: "disclaimer",
    title: "투자 및 데이터 면책",
    description: "고래지갑추적기의 정보가 투자 자문이나 수익 보장이 아니며 데이터에 지연과 오차가 있을 수 있음을 안내합니다.",
    body: `
      <header class="content-hero">
        <span class="content-kicker">투자 위험</span>
        <h1>투자 및 데이터 면책</h1>
        <p class="content-lede">이 사이트의 정보는 교육과 관찰 목적이며 투자 권유나 개인별 자문이 아닙니다.</p>
      </header>
      <section>
        <h2>매매 신호가 아닙니다</h2>
        <p>집중 점수, 방향 비중, 내부자 의심 후보 라벨과 순위는 공개 데이터를 정리한 관찰 지표입니다. 특정 자산의 매수, 매도, 보유를 권유하지 않으며 미래 가격이나 수익을 예측하지 않습니다.</p>
      </section>
      <section>
        <h2>내부자 의심은 사실 판정이 아닙니다</h2>
        <p>내부자 의심 후보는 큰 수익, 집중 노출, 방향 편중과 레버리지 같은 공개 지표의 조합을 설명하는 관찰 라벨입니다. 서비스는 지갑 소유자의 신원, 미공개 정보 보유 또는 이용 여부, 법률상 내부자 지위나 불법행위를 확인하지 않습니다. 라벨을 특정 개인이나 단체에 대한 사실 주장 또는 위법행위의 증거로 사용해서는 안 됩니다.</p>
      </section>
      <section>
        <h2>높은 위험을 이해하세요</h2>
        <p>디지털 자산과 파생상품은 가격 변동성이 크며 레버리지 거래에서는 원금 전부를 잃을 수 있습니다. 타인의 공개 포지션을 따라 해도 같은 진입 가격, 수수료, 청산 조건이나 결과를 얻을 수 없습니다.</p>
      </section>
      <section>
        <h2>데이터에는 지연과 오차가 있습니다</h2>
        <p>지갑 조회가 순차적으로 진행되고 응답이 캐시되므로 화면의 값은 동일한 시점의 완전한 스냅샷이 아닐 수 있습니다. 포지션 가치, 현재가, ROE와 청산가는 외부 응답과 계산 방식에 따라 실제 거래 화면과 다를 수 있습니다.</p>
      </section>
      <section>
        <h2>독립적으로 확인하세요</h2>
        <p>중요한 의사결정을 내리기 전에 거래소 원문, 공식 문서와 복수의 정보원을 확인하세요. 자신의 재무 상황과 위험 감수 능력을 고려하고 필요한 경우 관련 자격을 가진 전문가에게 상담하세요.</p>
      </section>
    `,
  },
  {
    slug: "contact",
    title: "운영자 문의",
    description: "고래지갑추적기의 오류 제보, 데이터 정정, 개인정보와 서비스 운영 문의 방법을 안내합니다.",
    body: `
      <header class="content-hero">
        <span class="content-kicker">문의</span>
        <h1>운영자 문의</h1>
        <p class="content-lede">오류 제보와 서비스 개선 의견을 확인합니다.</p>
      </header>
      <section>
        <h2>문의할 때 포함해 주세요</h2>
        <ul>
          <li>문제가 발생한 페이지 주소</li>
          <li>발생 시각과 사용한 브라우저</li>
          <li>가능한 경우 화면에 표시된 오류 문구</li>
          <li>지갑 데이터 정정 요청인 경우 공개적으로 검증 가능한 근거</li>
        </ul>
      </section>
      <section>
        <h2>운영자와 처리 범위</h2>
        <p>고래지갑추적기는 <a href="https://github.com/hodookim" rel="noopener noreferrer">hodookim</a>이 운영하는 독립 프로젝트입니다. 데이터 오류, 개인정보, 저작권, 광고, 보안 문제와 편집 정정 요청을 구분해 확인합니다.</p>
        <p>지갑 개인 키, 시드 문구, 거래소 로그인 정보는 보내지 마세요. 공개 지갑 데이터의 정정 요청에는 원문 URL, 조회 시각, 재현 가능한 근거를 포함해 주세요.</p>
      </section>
      <section>
        <h2>정정 처리 원칙</h2>
        <ol>
          <li>페이지 주소와 제보 내용을 확인합니다.</li>
          <li>운영 코드, 공개 API 응답, 공식 문서를 대조합니다.</li>
          <li>오류가 확인되면 관련 페이지 또는 코드를 수정하고 수정일을 갱신합니다.</li>
          <li>산식 변경은 <a href="/editorial-policy">편집·검토 및 정정 정책</a>과 방법론에 기록합니다.</li>
        </ol>
      </section>
      <section class="content-callout">
        <h2>현재 운영 채널</h2>
        <p><a href="https://github.com/hodookim" rel="noopener noreferrer">GitHub @hodookim</a> 프로필의 공개 연락 채널을 이용해 주세요. 공개 저장소의 이슈를 이용할 때는 개인정보나 보안상 민감한 값을 게시하지 마세요.</p>
      </section>
    `,
  },
  ...editorialPages,
  ...snapshotReportPages,
  ...comparisonReportPages,
];

function navLinks() {
  return `
    <a href="/">홈</a>
    <a href="/live">라이브</a>
    <a href="/reports">리포트</a>
    <a href="/methodology">방법론</a>
  `;
}

function footerLinks() {
  return `
    <a href="/about">소개</a>
    <a href="/author/hodookim">운영자</a>
    <a href="/methodology">방법론</a>
    <a href="/reports">데이터 리포트</a>
    <a href="/editorial-policy">편집 정책</a>
    <a href="/privacy">개인정보처리방침</a>
    <a href="/terms">이용약관</a>
    <a href="/disclaimer">투자 면책</a>
    <a href="/contact">문의</a>
  `;
}

function contentSide(page) {
  const variants = {
    privacy: {
      title: "개인정보 안내",
      text: "관심 지갑은 브라우저에 저장되며 광고 사업자가 쿠키를 사용할 수 있습니다.",
      links: [["광고 설정", "https://adssettings.google.com/"], ["운영자 문의", "/contact"]],
    },
    terms: {
      title: "이용 안내",
      text: "이 서비스는 공개 데이터를 정리한 정보 도구이며 거래 기능을 제공하지 않습니다.",
      links: [["투자 위험 안내", "/disclaimer"], ["운영자 문의", "/contact"]],
    },
    disclaimer: {
      title: "위험 안내",
      text: "표시된 값은 투자 자문이나 수익 보장이 아니며 갱신 지연이 발생할 수 있습니다.",
      links: [["산정 방식", "/methodology"], ["포지션 지표", "/guides/positions"]],
    },
    contact: {
      title: "문의 안내",
      text: "페이지 주소, 발생 시각, 오류 문구를 함께 보내면 문제 확인에 도움이 됩니다.",
      links: [["서비스 소개", "/about"], ["개인정보 안내", "/privacy"]],
    },
    "author/hodookim": {
      title: "운영자 정보",
      text: "운영 코드, 데이터 검토와 정정 기록을 관리하는 주체를 공개합니다.",
      links: [["편집 정책", "/editorial-policy"], ["운영자 문의", "/contact"]],
    },
    reports: {
      title: "리포트 사용법",
      text: "시점별 스냅샷과 현재 라이브 화면을 비교하고, 원본 JSON과 집계 방법을 함께 확인하세요.",
      links: [["최신 라이브", "/live"], ["집계 방법론", "/methodology"]],
    },
    "guides/scoring": {
      title: "산식 검증",
      text: "두 점수는 정렬용 휴리스틱이며 미래 수익률을 예측하지 않습니다.",
      links: [["전체 방법론", "/methodology"], ["데이터 품질", "/guides/data-quality"]],
    },
    "reports/2026-07-11-market-snapshot": {
      title: "스냅샷 주의사항",
      text: "한 시점의 제한된 표본이며 현재 시장 전체나 이후 가격을 뜻하지 않습니다.",
      links: [["최신 라이브", "/live"], ["표본 편향", "/guides/leaderboard-bias"]],
    },
    "editorial-policy": {
      title: "운영 원칙",
      text: "출처·계산·정정 기준과 AI 보조 도구 사용 원칙을 공개합니다.",
      links: [["운영자 소개", "/about"], ["정정 문의", "/contact"]],
    },
  };
  const info = variants[page.slug] || (page.slug.startsWith("reports/") ? {
    title: "스냅샷 주의사항",
    text: "한 시점의 제한된 표본이며 현재 시장 전체나 이후 가격을 뜻하지 않습니다.",
    links: [["전체 리포트", "/reports"], ["최신 라이브", "/live"]],
  } : {
    title: "데이터 안내",
    text: "점수와 순위는 관측 지갑을 비교하기 위한 참고 지표입니다.",
    links: [["산정 방식", "/methodology"], ["투자 위험 안내", "/disclaimer"]],
  });
  return `<aside class="content-side">
    <strong>${info.title}</strong>
    <p>${info.text}</p>
    ${info.links.map(([label, href]) => `<a href="${href}">${label}</a>`).join("")}
  </aside>`;
}

export function renderContentPage(page, siteOrigin) {
  const canonical = `${siteOrigin}/${page.slug}`;
  const schemaType = page.schemaType || (page.article ? "Article" : "WebPage");
  const publishedAt = page.publishedAt || defaultPublishedAt;
  const modifiedAt = page.updatedAt || updatedAt;
  const author = {
    "@type": "Person",
    name: "hodookim",
    url: `${siteOrigin}/author/hodookim`,
    sameAs: ["https://github.com/hodookim"],
  };
  const publisher = { "@type": "Organization", name: "고래지갑추적기", url: `${siteOrigin}/` };
  const articleMeta = page.article
    ? `<div class="content-meta" aria-label="문서 정보"><span>작성·검토 <a href="/author/hodookim" rel="author">hodookim</a></span><span>발행 <time datetime="${publishedAt}">${publishedAt}</time></span><span>수정 <time datetime="${modifiedAt}">${modifiedAt}</time></span></div>`
    : "";
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${page.title} | 고래지갑추적기</title>
  <meta name="description" content="${page.description}">
  <meta name="theme-color" content="#070a0f">
  <meta name="google-adsense-account" content="ca-pub-6063034290894650">
  <link rel="canonical" href="${canonical}">
  <link rel="icon" type="image/svg+xml" href="/static/favicon.svg">
  <meta property="og:title" content="${page.title} | 고래지갑추적기">
  <meta property="og:description" content="${page.description}">
  <meta property="og:type" content="${page.article ? "article" : "website"}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="${siteOrigin}/static/assets/og-image.png">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="stylesheet" href="/static/css/system-v2.css?v=3">
  <link rel="stylesheet" href="/static/css/content-v2.css?v=5">
  <script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": schemaType,
    name: page.title,
    headline: page.title,
    description: page.description,
    url: canonical,
    inLanguage: "ko-KR",
    datePublished: publishedAt,
    dateModified: modifiedAt,
    author,
    publisher,
    isPartOf: { "@type": "WebSite", name: "고래지갑추적기", url: `${siteOrigin}/` },
  })}</script>
</head>
<body>
  <header class="content-topbar">
    <a class="content-brand" href="/" aria-label="고래지갑추적기 홈">
      <img src="/static/assets/logo/logo-symbol-dark.svg" alt="" width="36" height="36">
      <span>고래지갑추적기</span>
    </a>
    <nav aria-label="주요 내비게이션">${navLinks()}</nav>
  </header>
  <main class="content-shell">
    <article class="content-article">
      ${page.body}
      ${articleMeta}
      <p class="content-updated">최종 수정일 ${modifiedAt} · <a href="/editorial-policy">편집·정정 기준</a></p>
    </article>
    ${contentSide(page)}
  </main>
  <footer class="site-footer">
    <div><strong>고래지갑추적기</strong><p>Hyperliquid 공개 포지션을 비교·조회하는 정보 서비스입니다.</p></div>
    <nav aria-label="사이트 정보">${footerLinks()}</nav>
    <small>© 2026 고래지갑추적기</small>
  </footer>
</body>
</html>`;
}
