const db = require("../db/database");

const DEFAULT_SHIFT_START = "09:00";
const DEFAULT_SHIFT_END = "17:00";

const formatDate = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

const addDays = (date, amount) => {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return formatDate(result);
};

const getShiftSettings = () => {
  const settings = db
    .prepare(
      "SELECT shiftStartTime, shiftEndTime FROM settings WHERE id = 1",
    )
    .get();

  return {
    shiftStartTime: settings?.shiftStartTime || DEFAULT_SHIFT_START,
    shiftEndTime: settings?.shiftEndTime || DEFAULT_SHIFT_END,
  };
};

const getBusinessDayContext = (now = new Date()) => {
  const { shiftStartTime, shiftEndTime } = getShiftSettings();
  const [startHour, startMinute] = shiftStartTime.split(":").map(Number);
  const [endHour, endMinute] = shiftEndTime.split(":").map(Number);
  const start = startHour * 60 + startMinute;
  const end = endHour * 60 + endMinute;
  const current = now.getHours() * 60 + now.getMinutes();
  const overnight = end < start;
  const inShift = overnight
    ? current >= start || current < end
    : current >= start && current < end;
  const today = formatDate(now);
  const previousDate = addDays(now, -1);
  const businessDate = overnight
    ? current >= start
      ? today
      : previousDate
    : current < start
      ? previousDate
      : today;

  return {
    shiftStartTime,
    shiftEndTime,
    inShift,
    businessDate,
    today,
    previousBusinessDate: previousDate,
  };
};

module.exports = {
  getBusinessDayContext,
};
