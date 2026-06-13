function sumDigits(value) {
  return String(value)
    .replace(/\D/g, '')
    .split('')
    .reduce((sum, digit) => sum + Number(digit), 0);
}

function reduceNumber(value, keepMaster = true) {
  let n = Math.abs(Math.trunc(value));
  while (n > 9) {
    if (keepMaster && (n === 11 || n === 22 || n === 33)) {
      break;
    }
    n = sumDigits(n);
  }
  return n || 1;
}

function twoDigitCode(value) {
  return String((Math.abs(Math.trunc(value)) % 90) + 10);
}

function nameDigitSum(name = '') {
  let sum = 0;

  for (const ch of name.toLowerCase()) {
    if (ch >= 'а' && ch <= 'я') {
      sum += ch.charCodeAt(0) - 'а'.charCodeAt(0) + 1;
    } else if (ch >= 'a' && ch <= 'z') {
      sum += ch.charCodeAt(0) - 'a'.charCodeAt(0) + 1;
    }
  }

  return reduceNumber(sum);
}

function hashLabel(value = '') {
  let hash = 0;
  for (const ch of value) {
    hash = (hash * 31 + ch.charCodeAt(0)) % 100000;
  }
  return hash;
}

function placeSeed(data) {
  if (data.birth_place_lat != null && data.birth_place_lon != null) {
    return Math.round(Math.abs(data.birth_place_lat * 100) + Math.abs(data.birth_place_lon * 100));
  }

  return hashLabel(data.birth_place_label || data.birth_place || '');
}

/** Детерминированные коды из анкеты — AI объясняет логику, но не меняет числа. */
export function computePersonalityCodes(data) {
  const [day, month, year] = data.birth_date.split('.').map(Number);
  const [hour, minute] = data.birth_time.split(':').map(Number);

  const lifePath = reduceNumber(sumDigits(day) + sumDigits(month) + sumDigits(year));
  const nameNumber = nameDigitSum(data.name);
  const numerologyCode = `${lifePath}${nameNumber}`;

  const genderOffset = data.gender === 'male' ? 11 : 13;
  const birthPlaceSeed = placeSeed(data);

  const astrologyCode = twoDigitCode(day + month * 31 + hour + genderOffset);
  const humanDesignCode = twoDigitCode(hour * 60 + minute + day * month);
  const sucaiCode = twoDigitCode(
    sumDigits(day) + sumDigits(month) + sumDigits(year) + nameNumber * 7 + month,
  );
  const jyotishCode = twoDigitCode(birthPlaceSeed + year + month * 7 + hour + minute);

  const fullCode = `${astrologyCode}${humanDesignCode}${numerologyCode}${sucaiCode}${jyotishCode}`;

  return {
    fullCode,
    astrologyCode,
    humanDesignCode,
    numerologyCode,
    sucaiCode,
    jyotishCode,
    astrologyFormula:
      `дата рождения ${data.birth_date}, время ${data.birth_time} и пол (${data.gender_label}) → код западной астрологии ${astrologyCode}`,
    humanDesignFormula:
      `время рождения ${data.birth_time} и день×месяц (${day}×${month}) → код Human Design ${humanDesignCode}`,
    numerologyFormula:
      `число жизненного пути ${lifePath} (из даты ${data.birth_date}) + число имени ${nameNumber} (из «${data.name}») → ${numerologyCode}`,
    sucaiFormula:
      `дата рождения, имя «${data.name}» и энергия цифр 九宫术数 → код Сюцай ${sucaiCode}`,
    jyotishFormula:
      `место рождения (${data.birth_place_label}), дата и время → код ведической астрологии (Джойтиш) ${jyotishCode}`,
  };
}
