export type QueryCalendarParams = {
  queryType: 'today' | 'tomorrow' | 'next' | 'availability' | 'week_range';
  day?: 'today' | 'tomorrow';
  timeText?: string;
  availabilityDay?: 'today' | 'tomorrow';
  weekRangeKind?: 'this_week' | 'next_week';
  attendeeEmailSubstring?: string;
  personFilter?: string;
};
