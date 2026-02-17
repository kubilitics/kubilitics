import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Brain, CheckCircle2, AlertCircle, Info } from 'lucide-react';
import { MLModelInfo } from '@/hooks/useMLAnomalyDetection';
import { ForecastModelInfo } from '@/hooks/useTimeSeriesForecast';

interface ModelExplainabilityPanelProps {
  modelType: 'isolation_forest' | 'arima';
  modelInfo: MLModelInfo | ForecastModelInfo | null;
}

export function ModelExplainabilityPanel({
  modelType,
  modelInfo
}: ModelExplainabilityPanelProps) {
  if (!modelInfo) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Brain className="h-4 w-4" />
            Model Information
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No model information available</p>
        </CardContent>
      </Card>
    );
  }

  if (modelType === 'isolation_forest') {
    const mlInfo = modelInfo as MLModelInfo;

    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Brain className="h-4 w-4" />
              Isolation Forest Model
            </CardTitle>
            <Badge variant="secondary" className="text-xs">
              ML
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Model Overview */}
          <div>
            <h4 className="text-xs font-semibold mb-2">How It Works</h4>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Isolation Forest detects anomalies by isolating observations through random partitioning.
              Anomalies are easier to isolate and require fewer tree splits, resulting in shorter path lengths.
            </p>
          </div>

          {/* Model Parameters */}
          <div>
            <h4 className="text-xs font-semibold mb-2">Model Configuration</h4>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between items-center p-2 bg-gray-50 rounded">
                <span className="text-muted-foreground">Algorithm</span>
                <span className="font-semibold capitalize">{mlInfo.algorithm.replace('_', ' ')}</span>
              </div>
              <div className="flex justify-between items-center p-2 bg-gray-50 rounded">
                <span className="text-muted-foreground">Number of Trees</span>
                <span className="font-semibold">{mlInfo.num_trees}</span>
              </div>
              <div className="flex justify-between items-center p-2 bg-gray-50 rounded">
                <span className="text-muted-foreground">Sample Size</span>
                <span className="font-semibold">{mlInfo.sample_size}</span>
              </div>
              <div className="flex justify-between items-center p-2 bg-gray-50 rounded">
                <span className="text-muted-foreground">Threshold</span>
                <span className="font-semibold">{(mlInfo.threshold * 100).toFixed(0)}%</span>
              </div>
              <div className="flex justify-between items-center p-2 bg-gray-50 rounded">
                <span className="text-muted-foreground">Training Data Points</span>
                <span className="font-semibold">{mlInfo.total_points}</span>
              </div>
            </div>
          </div>

          {/* Interpretation Guide */}
          <div>
            <h4 className="text-xs font-semibold mb-2">Anomaly Score Interpretation</h4>
            <div className="space-y-2">
              <div className="flex items-start gap-2 text-xs">
                <AlertCircle className="h-4 w-4 text-red-600 mt-0.5" />
                <div>
                  <p className="font-semibold">Score &gt; 0.7 (Critical)</p>
                  <p className="text-muted-foreground">Strong anomaly - significantly different from normal patterns</p>
                </div>
              </div>
              <div className="flex items-start gap-2 text-xs">
                <AlertCircle className="h-4 w-4 text-orange-600 mt-0.5" />
                <div>
                  <p className="font-semibold">Score 0.6-0.7 (High)</p>
                  <p className="text-muted-foreground">Likely anomaly - deviates from normal behavior</p>
                </div>
              </div>
              <div className="flex items-start gap-2 text-xs">
                <Info className="h-4 w-4 text-yellow-600 mt-0.5" />
                <div>
                  <p className="font-semibold">Score 0.5-0.6 (Medium)</p>
                  <p className="text-muted-foreground">Borderline - slightly unusual but within normal variation</p>
                </div>
              </div>
              <div className="flex items-start gap-2 text-xs">
                <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5" />
                <div>
                  <p className="font-semibold">Score &lt; 0.5 (Normal)</p>
                  <p className="text-muted-foreground">Normal - consistent with expected patterns</p>
                </div>
              </div>
            </div>
          </div>

          {/* Model Performance */}
          <div>
            <h4 className="text-xs font-semibold mb-2">Model Quality</h4>
            <div className="space-y-2">
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span>Training Data Coverage</span>
                  <span className="font-semibold">
                    {mlInfo.total_points >= 100 ? 'Excellent' : mlInfo.total_points >= 50 ? 'Good' : 'Limited'}
                  </span>
                </div>
                <Progress
                  value={Math.min((mlInfo.total_points / 100) * 100, 100)}
                  className="h-2"
                />
              </div>
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span>Ensemble Strength</span>
                  <span className="font-semibold">
                    {mlInfo.num_trees >= 100 ? 'Strong' : mlInfo.num_trees >= 50 ? 'Good' : 'Basic'}
                  </span>
                </div>
                <Progress
                  value={Math.min((mlInfo.num_trees / 100) * 100, 100)}
                  className="h-2"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ARIMA Model
  const arimaInfo = modelInfo as ForecastModelInfo;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Brain className="h-4 w-4" />
            ARIMA Model
          </CardTitle>
          <Badge variant="secondary" className="text-xs">
            Time Series
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Model Overview */}
        <div>
          <h4 className="text-xs font-semibold mb-2">How It Works</h4>
          <p className="text-xs text-muted-foreground leading-relaxed">
            ARIMA (AutoRegressive Integrated Moving Average) models time series data by combining
            autoregression (past values), differencing (for stationarity), and moving averages (past errors).
          </p>
        </div>

        {/* Model Order */}
        <div>
          <h4 className="text-xs font-semibold mb-2">Model Order: ARIMA({arimaInfo.order.join(', ')})</h4>
          <div className="space-y-2 text-xs">
            <div className="flex items-start gap-2">
              <div className="px-2 py-1 bg-blue-100 text-blue-700 rounded font-mono font-semibold">
                p={arimaInfo.order[0]}
              </div>
              <div>
                <p className="font-semibold">AutoRegressive Order</p>
                <p className="text-muted-foreground">Uses {arimaInfo.order[0]} past value{arimaInfo.order[0] !== 1 ? 's' : ''} for prediction</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <div className="px-2 py-1 bg-purple-100 text-purple-700 rounded font-mono font-semibold">
                d={arimaInfo.order[1]}
              </div>
              <div>
                <p className="font-semibold">Differencing Order</p>
                <p className="text-muted-foreground">
                  {arimaInfo.order[1] === 0 ? 'No differencing (data is stationary)' :
                   arimaInfo.order[1] === 1 ? 'First-order differencing (removes linear trend)' :
                   'Second-order differencing (removes quadratic trend)'}
                </p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <div className="px-2 py-1 bg-green-100 text-green-700 rounded font-mono font-semibold">
                q={arimaInfo.order[2]}
              </div>
              <div>
                <p className="font-semibold">Moving Average Order</p>
                <p className="text-muted-foreground">Uses {arimaInfo.order[2]} past error{arimaInfo.order[2] !== 1 ? 's' : ''} for smoothing</p>
              </div>
            </div>
          </div>
        </div>

        {/* Model Coefficients */}
        {arimaInfo.ar_coeffs && arimaInfo.ar_coeffs.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold mb-2">AR Coefficients</h4>
            <div className="flex flex-wrap gap-2">
              {arimaInfo.ar_coeffs.map((coeff, idx) => (
                <div key={idx} className="px-2 py-1 bg-gray-100 rounded text-xs font-mono">
                  φ₍{idx + 1}₎ = {coeff.toFixed(3)}
                </div>
              ))}
            </div>
          </div>
        )}

        {arimaInfo.ma_coeffs && arimaInfo.ma_coeffs.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold mb-2">MA Coefficients</h4>
            <div className="flex flex-wrap gap-2">
              {arimaInfo.ma_coeffs.map((coeff, idx) => (
                <div key={idx} className="px-2 py-1 bg-gray-100 rounded text-xs font-mono">
                  θ₍{idx + 1}₎ = {coeff.toFixed(3)}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Model Quality */}
        <div>
          <h4 className="text-xs font-semibold mb-2">Model Quality</h4>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between items-center p-2 bg-gray-50 rounded">
              <span className="text-muted-foreground">Fitted</span>
              <Badge variant={arimaInfo.fitted ? 'default' : 'secondary'} className="text-xs">
                {arimaInfo.fitted ? 'Yes' : 'No'}
              </Badge>
            </div>
            <div className="flex justify-between items-center p-2 bg-gray-50 rounded">
              <span className="text-muted-foreground">Constant Term</span>
              <span className="font-mono font-semibold">{arimaInfo.constant.toFixed(3)}</span>
            </div>
            <div className="flex justify-between items-center p-2 bg-gray-50 rounded">
              <span className="text-muted-foreground">Standard Error</span>
              <span className="font-mono font-semibold">{arimaInfo.std_error.toFixed(3)}</span>
            </div>
            <div className="flex justify-between items-center p-2 bg-gray-50 rounded">
              <span className="text-muted-foreground">Training Residuals</span>
              <span className="font-semibold">{arimaInfo.n_residuals}</span>
            </div>
          </div>
        </div>

        {/* Confidence Interpretation */}
        <div>
          <h4 className="text-xs font-semibold mb-2">Confidence Intervals</h4>
          <p className="text-xs text-muted-foreground leading-relaxed">
            95% confidence intervals represent the range where we expect the true future value to fall
            95% of the time. Wider intervals indicate more uncertainty, which increases for longer forecast horizons.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
