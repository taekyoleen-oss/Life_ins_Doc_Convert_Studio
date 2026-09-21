/**
 * 조건 샘플. 사용자가 고쳐 쓰는 견본이라 YAML 글 그대로 둔다(주석이 작성법 안내다).
 * 값은 flexible_insurance 설계기 레시피와 같다 — 두 앱의 산출방법서를 맞대어 볼 수 있게.
 */

const EXPENSES = `expenses:           # 기호: α_S α_P β_S β_G β′ γ (산출방법서형) 또는 α β γ
  - { group: 계약체결비용, symbol: α_S, basis: 보험가입금액, rate: 1%, phase: 초년도 }
  - { group: 계약체결비용, symbol: α_P, basis: 기준연납순보험료, times: 1배, phase: 초년도 }
  - { group: 계약관리비용, symbol: β_S, basis: 매년 보험가입금액, rate: 1.5/1000, phase: 납입중 }
  - { group: 계약관리비용, symbol: β_G, basis: 영업보험료, rate: 4.5%, phase: 납입중 }
  - { group: 계약관리비용, symbol: β′, basis: 매년 보험가입금액, rate: 1/1000, phase: 납입후 }
  - { group: 수금비용, symbol: γ, basis: 영업보험료, rate: 2.5% }`;

const NOTES = `surrender:
  deductionYears: 7
  notes:
    - 해약공제 기준 신계약비는 적용기초율과 표준기초율로 구한 신계약비 중 작은 쪽으로 한다.
reserve:
  notes:
    - 회계연도말 보험료적립금은 적용기초율 적립금과 표준기초율 적립금 중 큰 금액으로 한다.
    - 연중 보간은 하지 않고 연말 기준으로 산출한다.`;

const Q = `  - id: q
    name: 제7회 경험생명표 사망률
    role: death
    source: 보험개발원 제7회 경험생명표 사망률`;

export interface Sample { id: string; label: string; hint: string; yaml: string }

export const SAMPLES: Sample[] = [
  { id: "whole", label: "종신보험 (사망·80% 이상 장해)", hint: "작성법 견본 — 항목마다 설명 주석", yaml: `# 산출방법서 조건 — 종신보험
# 왼쪽을 고치면 오른쪽 산출방법서가 바로 바뀝니다. 이율·사업비는 "2.5%", "1.5/1000" 처럼 적습니다.
# 한 줄을 고르면 오른쪽에서 그 조건이 만든 부분이 노랗게 표시됩니다(반대 방향도 됩니다).
meta:
  productName: 종신보험
  kind: 표준형(완전 환급)
contract:
  age: 40             # 가입나이
  sex: M              # M 남 / F 여
  termYears: 71       # 보험기간(년) — 110세 만기면 110 − 40 + 1
  payYears: 20        # 보험료 납입기간
  freq: 12            # 연 납입 횟수 (월납 12, 연납 1) — "월납" 이라고 써도 된다
basis:
  interest: 2.5%      # 적용(예정)이율
  standardInterest: 3.25%
  waiver: false       # 납입만 면제되는 추가 사유가 없으면 false → 납입자수 = 유지자수
rates:                # role: death 사망 · incidence 최초발생 · recurring 반복지급 · waiver 납입면제 · other 기타
${Q}
  - id: k80
    name: 80% 이상 장해율
    role: incidence
    source: 써미트 2014-59호 80%이상 재해장해 + 질병장해발생율
${EXPENSES}
benefits:
  - id: b1
    name: 사망·80% 이상 장해
    role: death       # 사망형 — 탈퇴 사유 전부에 같은 보험금
    trigger: 사망 또는 80% 이상 장해 시
    amount: 100000000
    endAge: 110
    exitRateIds: [q, k80]   # 유지자수·납입자수 = 1 − q − k + q·k/2
${NOTES}
` },
  { id: "twoMajor", label: "2대질병 진단보험 (80세 만기)", hint: "진단형 — 사망과 진단이 함께 탈퇴", yaml: `meta:
  productName: 2대질병 진단보험
  kind: 표준형(완전 환급)
contract:
  age: 40
  sex: M
  termYears: 41
  payYears: 20
  freq: 12
basis:
  interest: 2.5%
  standardInterest: 3.25%
  waiver: false
rates:
${Q}
  - id: k2
    name: 2대질병 발생률
    role: incidence
    source: 무배당 예정 뇌출혈 + 급성심근경색증 발생률 (제공 자료)
${EXPENSES}
benefits:
  - id: b1
    name: 2대질병 진단
    role: incidence
    trigger: 진단 확정 시
    amount: 30000000
    endAge: 80
    rateId: k2
    exitRateIds: [q, k2]
${NOTES}
` },
  { id: "noRefund", label: "무해지환급형 암보험 (해지율 3%)", hint: "저해지·무해지 — 해지율과 환급률", yaml: `meta:
  productName: 무해지환급형 암보험
  kind: 무해지환급형
contract:
  age: 40
  sex: M
  termYears: 61
  payYears: 20
  freq: 12
basis:
  interest: 2.5%
  standardInterest: 3.25%
  waiver: false
  lapse:
    - { label: 무해지환급형, rate: 3%, duringPayOnly: true }
  lowRatio: 0%        # 납입기간 중 해지환급금 = 표준형 × 0%
rates:
${Q}
  - id: kc
    name: 암발생률
    role: incidence
    source: 보험개발원 생명장기제2024-112호 무배당 예정 경험 암발생률
${EXPENSES}
benefits:
  - id: b1
    name: 암 진단
    role: incidence
    trigger: 진단 확정 시
    amount: 50000000
    endAge: 100
    waitDays: 90
    rateId: kc
    exitRateIds: [q, kc]
${NOTES}
` },
  { id: "waiverSupport", label: "보험료납입지원 3대질병", hint: "추가 납입면제 사유 — 80% 이상 장해", yaml: `meta:
  productName: 보험료납입지원 적용 3대질병보험
  kind: 표준형(완전 환급)
contract:
  age: 40
  sex: M
  termYears: 41
  payYears: 20
  freq: 12
basis:
  interest: 2.5%
  standardInterest: 3.25%
  waiver: true        # 3대질병은 이미 탈퇴 사유 — 80% 이상 장해만 납입을 추가로 면제
rates:
${Q}
  - id: k3
    name: 3대질병 발생률
    role: incidence
    source: 암 + 뇌출혈 + 급성심근경색증 발생률
  - id: f80
    name: 80% 이상 장해율
    role: waiver
    source: 써미트 2014-59호 80%이상 재해장해 + 질병장해발생율
${EXPENSES}
benefits:
  - id: b1
    name: 3대질병 진단
    role: incidence
    trigger: 진단 확정 시
    amount: 30000000
    endAge: 80
    rateId: k3
    exitRateIds: [q, k3]
${NOTES}
` },
];
