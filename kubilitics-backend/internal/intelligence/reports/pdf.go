package reports

import "encoding/json"

// FormatForPDF returns the report as JSON bytes formatted for frontend PDF rendering.
// The frontend uses jsPDF to render the structured data into a downloadable PDF.
// This approach avoids a server-side PDF library dependency while keeping the
// report generation logic on the backend.
func FormatForPDF(report *ResilienceReport) ([]byte, error) {
	report.Format = "pdf"
	return json.Marshal(report)
}
